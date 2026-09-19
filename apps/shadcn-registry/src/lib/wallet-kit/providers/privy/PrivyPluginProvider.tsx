"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Chain, Hex } from "viem";
import type { WalletEip712Payload } from "@aomi-labs/react";
import { toViemSignTypedDataArgs } from "@aomi-labs/react";
import { AomiWalletKitComposer } from "../../composer/AomiWalletKitComposer";
import type { AuthRuntime, ExecutionRuntime } from "../../composer/types";
import { useResolvedAccountRuntime } from "../../account/use-resolved-account-runtime";
import { buildEvmExecutionRuntime } from "../../execution/execution-runtime";
import { useAomiWalletNetworkPreferences } from "../../network-preferences";
import { useEvmWalletRuntime } from "../../runtime/evm/wallet-runtime";
import {
  useMergedSvmWallet,
  useSafeSvmWallet,
  useSvmWalletRuntime,
  type SafeSvmWalletState,
} from "../../runtime/svm/wallet-runtime";
import { REGISTRY_STORAGE_KEY } from "../../registry/types";
import type { AomiAccount, AomiAccountCredential } from "../../types";
import type { AccountConfig, ExecutionConfig } from "../../config/types";
import {
  inferPrivyAuthMethod,
  inferPrivyPrimaryLabel,
  pickPrivyEmbeddedEvmWallet,
  pickPrivyEmbeddedEvmUserWallet,
  privyLoginMethodsToOptions,
  useSafePrivy,
  useSafeSmartWallets,
  useSafeSvmWallets,
  useSafeWallets,
} from "./privy-auth";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { buildPrivySvmWalletState } from "./privy-svm";
import { sendPrivySmartWalletTransaction } from "./privy-execution";
import {
  sendPrivyEmbeddedTransaction,
  switchPrivyEmbeddedChain,
  type PrivyEmbeddedEvmWallet,
} from "./privy-embedded-execution";
import { useEmbeddedSessionSource } from "../sources/embedded-session-source";

export type AomiPrivyPluginProviderProps = {
  children: ReactNode;
  supportedChains: readonly Chain[];
  loginMethods?: PrivyClientConfig["loginMethods"];
  execution?: ExecutionConfig;
  account?: AccountConfig;
  preferDirectSend?: boolean;
  externalSvmWallet?: SafeSvmWalletState;
};

export function AomiPrivyPluginProvider({
  children,
  supportedChains,
  loginMethods,
  execution,
  account,
  preferDirectSend = true,
  externalSvmWallet,
}: AomiPrivyPluginProviderProps) {
  const privy = useSafePrivy();
  const { client: smartWalletClient, getClientForChain } =
    useSafeSmartWallets();
  const { wallets: solanaWallets } = useSafeSvmWallets();
  const { wallets: connectedWallets } = useSafeWallets();
  const contextSvmWallet = useSafeSvmWallet();
  const [activeSolanaAddress, setActiveSolanaAddress] = useState<
    string | undefined
  >();
  const {
    selectedEvmChainId,
    selectedSolanaNetwork,
    setSelectedEvmChainId,
    setSelectedSolanaNetworkId,
    supportedSolanaNetworks,
  } = useAomiWalletNetworkPreferences();
  const evmRuntime = useEvmWalletRuntime({
    configuredChains: supportedChains,
    selectedEvmChainId,
    setSelectedEvmChainId,
    storageKey: REGISTRY_STORAGE_KEY,
    providerHooks: { providerLogout: privy.logout },
  });
  const startPrivyAuthFlow = useCallback(
    (reason: string) => {
      evmRuntime.registryStore.dispatch({
        type: "provider/auth-flow-started",
        reason,
        now: Date.now(),
      });
    },
    [evmRuntime.registryStore],
  );
  const smartAddress = smartWalletClient?.account?.address as Hex | undefined;
  // Embedded EVM EOA from Privy's connected-wallet snapshot or user record.
  // Surfaced as a synthetic EVM connection so it appears in "Connected now"
  // with write capability, mirroring the Para session source. Falls back to
  // the smart wallet address when one is active so account-abstracted
  // execution stays the primary surface when present.
  const embeddedEvmWallet = pickPrivyEmbeddedEvmWallet(connectedWallets);
  const embeddedEvmUserWallet = pickPrivyEmbeddedEvmUserWallet(privy.user);
  const embeddedEvmAddress = (embeddedEvmWallet?.address ??
    embeddedEvmUserWallet?.address) as Hex | undefined;
  // Backend-owned AA treats Privy's embedded EOA as the owner and provisions
  // its executor server-side. Never replace the owner identity with Privy's
  // client-managed smart account when both are present.
  const sessionEvmAddress = embeddedEvmAddress ?? smartAddress ?? null;
  const sessionReady =
    privy.authenticated &&
    Boolean(embeddedEvmWallet || embeddedEvmUserWallet || smartAddress);
  const activeSolanaWallet =
    solanaWallets.find((wallet) => wallet.address === activeSolanaAddress) ??
    solanaWallets[0];
  const privySvmWallet = useMemo(
    () =>
      buildPrivySvmWalletState({
        wallet: activeSolanaWallet,
        wallets: solanaWallets,
        setActiveAddress: setActiveSolanaAddress,
      }),
    [activeSolanaWallet, solanaWallets],
  );
  const svmWallet = useMergedSvmWallet(
    externalSvmWallet ?? contextSvmWallet,
    privySvmWallet,
  );

  useEffect(() => {
    if (
      activeSolanaAddress &&
      solanaWallets.some((wallet) => wallet.address === activeSolanaAddress)
    ) {
      return;
    }
    setActiveSolanaAddress(solanaWallets[0]?.address);
  }, [activeSolanaAddress, solanaWallets]);

  useEmbeddedSessionSource(evmRuntime.registryStore, {
    up: sessionReady,
    providerId: "privy",
    uid: "privy-smart-session",
    stableId: "privy",
    walletName: "Privy Smart Wallet",
    embeddedEvmAddress: sessionEvmAddress,
    chainId: selectedEvmChainId,
  });

  const authMethod = inferPrivyAuthMethod(privy.user);
  const primaryLabel = inferPrivyPrimaryLabel(privy.user);
  const authRuntime = useMemo<AuthRuntime>(
    () => ({
      provider: "privy",
      sessionProvider: "privy",
      embeddedProvider: "privy",
      providerLabel: "Privy",
      status: !privy.ready
        ? "booting"
        : privy.authenticated
          ? "authenticated"
          : "unauthenticated",
      subject: privy.user?.id,
      primaryLabel,
      authMethod,
      authValue: primaryLabel,
      methods: privyLoginMethodsToOptions(loginMethods),
      canOpenModal: Boolean(privy.login),
      startFlow: startPrivyAuthFlow,
      login: async (reason = "provider-auth-modal") => {
        evmRuntime.registryStore.dispatch({
          type: "user/provider-reconnect-requested",
          now: Date.now(),
        });
        startPrivyAuthFlow(reason);
        await privy.login();
      },
      logout: privy.logout,
      getCredential:
        (privy.getIdentityToken ?? privy.getAccessToken)
          ? async (): Promise<AomiAccountCredential | null> => {
              const identityToken = (await privy.getIdentityToken?.())?.trim();
              if (identityToken) {
                return {
                  provider: "privy",
                  tokenKind: "identity_token",
                  providerToken: identityToken,
                };
              }
              const accessToken = (await privy.getAccessToken?.())?.trim();
              return accessToken
                ? {
                    provider: "privy",
                    tokenKind: "access_token",
                    providerToken: accessToken,
                  }
                : null;
            }
          : undefined,
    }),
    [
      authMethod,
      loginMethods,
      primaryLabel,
      privy.authenticated,
      privy.getAccessToken,
      privy.getIdentityToken,
      privy.login,
      privy.logout,
      privy.ready,
      privy.user?.id,
      evmRuntime.registryStore,
      startPrivyAuthFlow,
    ],
  );

  const transformPrivyAccounts = useCallback(
    (accounts: AomiAccount[]) =>
      accounts.map((account) => {
        if (
          !privy.authenticated ||
          account.provider !== "privy" ||
          (account.walletKind !== "embedded" &&
            account.walletKind !== "smart_account")
        ) {
          return account;
        }
        return {
          ...account,
          linkedVia: account.linkedVia ?? "privy",
          actions: [{ kind: "signout" as const, label: "Sign out" }],
        };
      }),
    [privy.authenticated],
  );

  // Which key actually signs and sends for EVM, decided once so signing and
  // execution can never disagree about the address.
  //
  // An external wallet (MetaMask, Rabby, WalletConnect) wins when one is
  // connected: it owns both lanes through wagmi, so we add no overrides. Then
  // the embedded EOA, which is also the address the kit publishes as the
  // user's identity (`sessionEvmAddress` above) and therefore the address the
  // backend quotes against. The client smart account is last: it only becomes
  // the signer when there is no embedded EOA to be the identity, so a swap
  // priced for the EOA can never be sent from the smart account.
  const externalSignerActive = evmRuntime.shouldUseExternalSigner;
  const embeddedSigner = useMemo<{
    wallet: PrivyEmbeddedEvmWallet;
    owner: Hex;
  } | null>(
    () =>
      !externalSignerActive && embeddedEvmWallet && embeddedEvmAddress
        ? { wallet: embeddedEvmWallet, owner: embeddedEvmAddress }
        : null,
    [embeddedEvmAddress, embeddedEvmWallet, externalSignerActive],
  );
  const smartWalletSigner =
    !externalSignerActive && !embeddedSigner && smartWalletClient
      ? smartWalletClient
      : null;

  const svmRuntime = useSvmWalletRuntime({
    preferDirectSend,
    registryStore: evmRuntime.registryStore,
    selectedNetwork: selectedSolanaNetwork,
    supportedNetworks: supportedSolanaNetworks,
    setSelectedNetworkId: setSelectedSolanaNetworkId,
    wallet: svmWallet,
  });
  const executionRuntime = useMemo<ExecutionRuntime>(
    () => ({
      evm: buildEvmExecutionRuntime(evmRuntime, {
        signMessage: embeddedSigner
          ? async (payload: WalletEip712Payload) => {
              const owner = payload.signer ?? embeddedSigner.owner;
              if (owner.toLowerCase() !== embeddedSigner.owner.toLowerCase()) {
                throw new Error(
                  "The active Privy EOA is not the requested signer",
                );
              }
              if (!payload.non_typed_data) {
                throw new Error("Missing non_typed_data payload");
              }
              const provider =
                await embeddedSigner.wallet.getEthereumProvider();
              const signature = await provider.request({
                method: "personal_sign",
                params: [payload.non_typed_data, owner],
              });
              if (typeof signature !== "string") {
                throw new Error("Privy returned an invalid signature");
              }
              return { signature };
            }
          : undefined,
        // The embedded EOA deliberately sets no `sendTransaction`: leaving it
        // unset lets `buildEvmExecutionRuntime` wrap the primitives below in
        // the shared executor, which handles chain selection, sequential
        // batches, nonce-safe ordering and partial-batch reporting.
        sendTransaction:
          smartWalletSigner && execution?.aa !== "off"
            ? async (payload) =>
                sendPrivySmartWalletTransaction({
                  payload,
                  smartWalletClient: smartWalletSigner,
                  getClientForChain,
                  wagmiChainId: evmRuntime.activeEvmConnection?.chainId,
                  smartAddress,
                })
            : undefined,
        ...(embeddedSigner
          ? {
              sendTransactionAsync: async (args: {
                chainId?: number;
                to: Hex;
                value?: bigint;
                data?: Hex;
              }) => {
                // wagmi types both as optional; the shared executor always
                // resolves a chain before it calls this.
                if (args.chainId === undefined) {
                  throw new Error(
                    "Privy embedded sends require a resolved chain id",
                  );
                }
                return sendPrivyEmbeddedTransaction({
                  wallet: embeddedSigner.wallet,
                  owner: embeddedSigner.owner,
                  chainId: args.chainId,
                  to: args.to,
                  value: args.value ?? BigInt(0),
                  data: args.data,
                });
              },
              switchChainAsync: async ({ chainId }: { chainId: number }) =>
                switchPrivyEmbeddedChain(embeddedSigner.wallet, chainId),
              // No EIP-5792 on the embedded EOA, so batches go out as
              // sequential sends rather than a `sendCalls` the wallet would
              // reject.
              sendCallsSyncAsync: undefined,
              capabilities: undefined,
            }
          : {}),
        signTypedData: embeddedSigner
          ? async (payload: WalletEip712Payload) => {
              const owner = payload.signer ?? embeddedSigner.owner;
              if (owner.toLowerCase() !== embeddedSigner.owner.toLowerCase()) {
                throw new Error(
                  "The active Privy EOA is not the requested signer",
                );
              }
              const args = toViemSignTypedDataArgs(payload);
              if (!args) throw new Error("Missing typed_data payload");
              const provider =
                await embeddedSigner.wallet.getEthereumProvider();
              const signature = await provider.request({
                method: "eth_signTypedData_v4",
                params: [owner, JSON.stringify(args)],
              });
              if (typeof signature !== "string") {
                throw new Error("Privy returned an invalid signature");
              }
              return { signature };
            }
          : smartWalletSigner
            ? async (payload: WalletEip712Payload) => {
                const args = toViemSignTypedDataArgs(payload);
                if (!args) throw new Error("Missing typed_data payload");
                const signature = await smartWalletSigner.signTypedData(
                  args as never,
                );
                return { signature };
              }
            : undefined,
      }),
    }),
    [
      embeddedSigner,
      evmRuntime,
      execution,
      getClientForChain,
      smartAddress,
      smartWalletSigner,
    ],
  );
  const accountRuntime = useResolvedAccountRuntime({
    account,
    auth: authRuntime,
    evm: evmRuntime,
    svm: svmRuntime,
  });

  return (
    <AomiWalletKitComposer
      auth={authRuntime}
      account={accountRuntime}
      evm={evmRuntime}
      svm={svmRuntime}
      execution={executionRuntime}
      transformAccounts={transformPrivyAccounts}
      supportedChains={supportedChains}
    >
      {children}
    </AomiWalletKitComposer>
  );
}
