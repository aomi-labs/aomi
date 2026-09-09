"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { type Chain } from "viem";
import type { TOAuthMethod } from "@getpara/react-sdk";
import { AomiWalletKitComposer } from "../../composer/AomiWalletKitComposer";
import { useResolvedAccountRuntime } from "../../account/use-resolved-account-runtime";
import type {
  AuthRuntime,
  ExecutionRuntime,
  SvmWalletRuntime,
} from "../../composer/types";
import type { AccountConfig, ExecutionConfig } from "../../config/types";
import { useAomiWalletNetworkPreferences } from "../../network-preferences";
import { safeEnv } from "../../env";
import { inferAuthMethod } from "../../identity";
import {
  useEvmWalletRuntime,
  type EvmWalletRuntimeProviderHooks,
} from "../../runtime/evm/wallet-runtime";
import { toSocialLoginOption } from "../../runtime/evm/brands";
import { canonicalWalletKey } from "../../catalog/wallet-branding";
import { DEFAULT_SVM_CLUSTER } from "../../catalog/svm-networks";
import { REGISTRY_STORAGE_KEY } from "../../registry/types";
import { walletDebug } from "../../wallet-debug";
import { buildEvmExecutionRuntime } from "../../execution/execution-runtime";
import type { AomiAccount, SvmNetworkOption } from "../../types";
import { PARA_BRAND_KEY, PARA_SESSION_UID } from "./para-brand";
import { shouldConnectParaEvmSession } from "./para-evm-session";
import {
  DEFAULT_SVM_ENDPOINT,
  useSafeSvmWallet,
  useSvmWalletRuntime,
  type SafeSvmWalletState,
} from "../../runtime/svm/wallet-runtime";
import { useParaSessionSource } from "./sources/para-session-source";
import { isParaEmbeddedAccount } from "./para-embedded-wallet";
import {
  findParaSigningWallet,
  signParaMessage,
  signParaTypedData,
  signParaSolanaMessage,
} from "./para-message-signing";
import {
  defaultOAuthMethods,
  resolveParaAuthValue,
  resolveParaSubject,
  createParaCredentialGetter,
  useSafeLogout,
  useSafeParaAccount,
  useSafeParaClient,
  useSafeParaModal,
} from "./para-auth";

type PluginSvmRuntimeConfig = Pick<
  {
    cluster: SvmNetworkOption["cluster"];
    rpcHttpUrl: string;
    rpcWsUrl?: string;
    preferDirectSend: boolean;
  },
  "cluster" | "rpcHttpUrl" | "rpcWsUrl" | "preferDirectSend"
>;

export type AomiParaPluginProviderProps = {
  children: ReactNode;
  supportedChains?: readonly Chain[];
  svmConfig?: PluginSvmRuntimeConfig;
  selectedSolanaNetwork?: SvmNetworkOption;
  setSelectedSolanaNetworkId?: (networkId: string) => void;
  supportedSolanaNetworks?: readonly SvmNetworkOption[];
  oAuthMethods?: readonly TOAuthMethod[];
  execution?: ExecutionConfig;
  account?: AccountConfig;
  externalSvmWallet?: SafeSvmWalletState;
};

const PARA_EVM_CONNECT_RETRY_COOLDOWN_MS = 30_000;

export function AomiParaPluginProvider({
  children,
  supportedChains: configuredChains,
  svmConfig,
  selectedSolanaNetwork: selectedSolanaNetworkProp,
  setSelectedSolanaNetworkId: setSelectedSolanaNetworkIdProp,
  supportedSolanaNetworks: supportedSolanaNetworksProp,
  oAuthMethods = defaultOAuthMethods,
  execution,
  account,
  externalSvmWallet,
}: AomiParaPluginProviderProps) {
  const paraAccount = useSafeParaAccount();
  const paraSession = useSafeParaClient();
  const issueJwt = useMemo(
    () => createParaCredentialGetter(paraSession),
    [paraSession],
  );
  const paraLogout = useSafeLogout();
  const paraModal = useSafeParaModal();
  const contextSvmWallet = useSafeSvmWallet();
  const svmWallet = externalSvmWallet ?? contextSvmWallet;
  const logoutParaSession = useCallback(async () => {
    if (paraLogout) {
      try {
        walletDebug("para:logout", { via: "useLogout" });
        await paraLogout();
        walletDebug("para:logout", { result: "ok" });
        return;
      } catch (error) {
        walletDebug("para:logout", { failed: String(error) });
        console.warn("[aomi-wallet-kit] Para logout failed", error);
      }
    }

    const clientLogout = (
      paraSession as unknown as {
        logout?: (args?: unknown) => Promise<unknown>;
      } | null
    )?.logout;
    if (typeof clientLogout !== "function") {
      walletDebug("para:logout", {
        skip: paraLogout ? "hook-failed-no-client-fallback" : "no-path",
      });
      return;
    }
    try {
      walletDebug("para:logout", { via: "client" });
      await clientLogout.call(paraSession);
      walletDebug("para:logout", { result: "ok" });
    } catch (error) {
      walletDebug("para:logout", { failed: String(error) });
      console.warn("[aomi-wallet-kit] Para logout failed", error);
    }
  }, [paraLogout, paraSession]);
  const {
    selectedEvmChainId,
    selectedSolanaNetwork: preferenceSelectedSolanaNetwork,
    setSelectedEvmChainId,
    setSelectedSolanaNetworkId: preferenceSetSelectedSolanaNetworkId,
    supportedSolanaNetworks: preferenceSupportedSolanaNetworks,
  } = useAomiWalletNetworkPreferences();
  const selectedSolanaNetwork =
    selectedSolanaNetworkProp ?? preferenceSelectedSolanaNetwork;
  const setSelectedSolanaNetworkId =
    setSelectedSolanaNetworkIdProp ?? preferenceSetSelectedSolanaNetworkId;
  const supportedSolanaNetworks =
    supportedSolanaNetworksProp ?? preferenceSupportedSolanaNetworks;
  const resolvedAdapterSvmConfig = useMemo<PluginSvmRuntimeConfig>(
    () => ({
      cluster: svmConfig?.cluster ?? DEFAULT_SVM_CLUSTER,
      rpcHttpUrl:
        svmConfig?.rpcHttpUrl ??
        safeEnv(() => process.env.NEXT_PUBLIC_SOLANA_RPC_URL) ??
        DEFAULT_SVM_ENDPOINT,
      rpcWsUrl:
        svmConfig?.rpcWsUrl ??
        safeEnv(() => process.env.NEXT_PUBLIC_SOLANA_RPC_WS_URL) ??
        undefined,
      preferDirectSend: svmConfig?.preferDirectSend ?? true,
    }),
    [svmConfig],
  );
  const providerHooks = useMemo<EvmWalletRuntimeProviderHooks>(
    () => ({
      providerLogout: logoutParaSession,
      isProviderInternalConnector: (connector) =>
        connector.id === PARA_BRAND_KEY ||
        canonicalWalletKey(connector.name ?? "") === PARA_BRAND_KEY,
      onProviderReconnectRequested: (store) => {
        store.dispatch({
          type: "user/provider-reconnect-requested",
          now: Date.now(),
        });
      },
      onConnectFallback: (store) => {
        store.dispatch({
          type: "provider/auth-flow-started",
          reason: "provider-auth-connect-fallback",
          now: Date.now(),
        });
        paraModal?.openModal({ step: "AUTH_MAIN" });
      },
      onAccountDisconnectPlanned: (disconnectPlan) => {
        if (
          disconnectPlan.isProviderOwnedAccount &&
          disconnectPlan.otherConnectionsRemain
        ) {
          walletDebug("para:detach", {
            address: disconnectPlan.targetAddress,
            reason: "preserve-external-wallets",
          });
        }
      },
      signMessageForProviderAccount: async ({ connection, message }) => {
        if (connection.stableId !== PARA_BRAND_KEY || !paraSession) {
          return null;
        }
        return signParaMessage(
          paraSession,
          connection.address as `0x${string}`,
          message,
        );
      },
    }),
    [logoutParaSession, paraModal, paraSession],
  );
  const evmRuntime = useEvmWalletRuntime({
    configuredChains,
    selectedEvmChainId,
    setSelectedEvmChainId,
    storageKey: REGISTRY_STORAGE_KEY,
    providerHooks,
  });
  const { connect: connectEvm, registryStore, registryState } = evmRuntime;
  useParaSessionSource(registryStore, { paraAccount });
  // `inFlight` stops concurrent connects; `retryAfter` stops a hot retry loop.
  // The effect re-runs on every new `registryState.connections` identity, so a
  // connect that keeps failing would otherwise be retried on each store
  // dispatch with no backoff. Mirrors the JWT-issuance cooldown in para-auth.
  const paraConnectRef = useRef({ inFlight: false, retryAfter: 0 });
  const startParaAuthFlow = useCallback(
    (reason: string) => {
      registryStore.dispatch({
        type: "provider/auth-flow-started",
        reason,
        now: Date.now(),
      });
    },
    [registryStore],
  );
  const registryDetachedParaAddresses = registryState.intents
    .providerSessionDetached
    ? registryState.intents.droppedAddresses
    : [];
  const paraSessionLocallyDetached = Boolean(
    paraAccount.isConnected && registryState.intents.providerSessionDetached,
  );
  const exposeParaSession = Boolean(
    paraAccount.isConnected && !paraSessionLocallyDetached,
  );
  useEffect(() => {
    if (
      !paraSession ||
      paraConnectRef.current.inFlight ||
      Date.now() < paraConnectRef.current.retryAfter ||
      !shouldConnectParaEvmSession(exposeParaSession, registryState.connections)
    ) {
      return;
    }

    paraConnectRef.current.inFlight = true;
    void connectEvm(PARA_BRAND_KEY)
      .then(() => {
        paraConnectRef.current.retryAfter = 0;
      })
      .catch((error) => {
        paraConnectRef.current.retryAfter =
          Date.now() + PARA_EVM_CONNECT_RETRY_COOLDOWN_MS;
        walletDebug("para:evm-connect-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        paraConnectRef.current.inFlight = false;
      });
  }, [connectEvm, exposeParaSession, paraSession, registryState.connections]);
  const paraSubject = exposeParaSession
    ? resolveParaSubject(paraAccount, paraSession)
    : undefined;
  const embeddedPrimary = exposeParaSession
    ? (paraAccount.embedded.email ??
      paraAccount.embedded.farcasterUsername ??
      paraAccount.embedded.telegramUserId ??
      undefined)
    : undefined;
  const paraAuthMethod = inferAuthMethod(paraAccount.embedded.authMethods);
  const authRuntime = useMemo<AuthRuntime>(
    () => ({
      provider: "para",
      sessionProvider: "para",
      embeddedProvider: "para",
      providerLabel: "Para",
      subject: paraSubject,
      status: paraAccount.isLoading
        ? "booting"
        : exposeParaSession
          ? "authenticated"
          : "unauthenticated",
      primaryLabel: embeddedPrimary,
      authMethod: embeddedPrimary ? paraAuthMethod : undefined,
      authValue: embeddedPrimary
        ? resolveParaAuthValue(paraAccount.embedded, paraAuthMethod)
        : undefined,
      methods: paraModal
        ? Array.from(oAuthMethods).map(toSocialLoginOption)
        : [],
      canOpenModal: Boolean(paraModal),
      startFlow: startParaAuthFlow,
      login: async (reason: string, step = "AUTH_MAIN") => {
        registryStore.dispatch({
          type: "user/provider-reconnect-requested",
          now: Date.now(),
        });
        startParaAuthFlow(reason);
        paraModal?.openModal({ step });
      },
      openAccountUI: async (reason: string, step = "ACCOUNT_MAIN") => {
        startParaAuthFlow(reason);
        paraModal?.openModal({ step });
      },
      logout: logoutParaSession,
      getCredential: exposeParaSession ? (issueJwt ?? undefined) : undefined,
    }),
    [
      embeddedPrimary,
      exposeParaSession,
      issueJwt,
      logoutParaSession,
      oAuthMethods,
      paraAccount.embedded,
      paraAccount.isLoading,
      paraAuthMethod,
      paraModal,
      paraSubject,
      registryStore,
      startParaAuthFlow,
    ],
  );
  const svmRuntime = useSvmWalletRuntime({
    preferDirectSend: resolvedAdapterSvmConfig.preferDirectSend,
    registryStore,
    selectedNetwork: selectedSolanaNetwork,
    supportedNetworks: supportedSolanaNetworks,
    setSelectedNetworkId: setSelectedSolanaNetworkId,
    wallet: svmWallet,
  });
  const providerEvmWalletOptions = useMemo(() => [], []);
  const transformEvmIdentity = useCallback(
    (identity: ReturnType<typeof evmRuntime.identity>) => {
      if (
        paraSessionLocallyDetached &&
        identity.address &&
        registryDetachedParaAddresses.includes(identity.address.toLowerCase())
      ) {
        return {};
      }
      return identity;
    },
    [paraSessionLocallyDetached, registryDetachedParaAddresses],
  );
  const transformAccounts = useCallback(
    (accounts: AomiAccount[]) =>
      accounts
        .filter((account) => {
          if (!paraSessionLocallyDetached) return true;
          if (account.family !== "evm") return true;
          const address = account.address.toLowerCase();
          if (registryDetachedParaAddresses.includes(address)) return false;
          return !isParaEmbeddedAccount(account);
        })
        .map((account) => {
          if (!exposeParaSession || !isParaEmbeddedAccount(account)) {
            return account;
          }
          return {
            ...account,
            manageable: Boolean(paraModal),
            actions: [
              ...(paraModal
                ? [{ kind: "manage" as const, label: "Manage" }]
                : []),
              { kind: "signout" as const, label: "Sign out" },
            ],
          };
        }),
    [
      exposeParaSession,
      paraModal,
      paraSessionLocallyDetached,
      registryDetachedParaAddresses,
    ],
  );
  const canManageParaAccount = useCallback(
    (account: AomiAccount) =>
      Boolean(paraModal) && exposeParaSession && isParaEmbeddedAccount(account),
    [exposeParaSession, paraModal],
  );
  const executionRuntime = useMemo<ExecutionRuntime>(() => {
    const evm = buildEvmExecutionRuntime(evmRuntime);
    return {
      canSignFor: (family, address) => {
        if (
          exposeParaSession &&
          paraSession?.signMessage &&
          findParaSigningWallet(paraSession, address, family)?.id
        )
          return true;
        return family === "evm"
          ? Boolean(
              evmRuntime.activeConnector &&
              evm.signTypedData &&
              evmRuntime.activeEvmConnection?.address.toLowerCase() ===
                address.toLowerCase(),
            )
          : Boolean(
              svmWallet.connected &&
              svmWallet.signMessage &&
              svmWallet.publicKey === address,
            );
      },
      evm: {
        ...evm,
        signTypedData: async (payload) => {
          const address =
            payload.signer ?? evmRuntime.activeEvmConnection?.address;
          if (
            address &&
            exposeParaSession &&
            paraSession &&
            findParaSigningWallet(paraSession, address)?.id
          ) {
            return signParaTypedData(paraSession, address, payload);
          }
          if (!evm.signTypedData)
            throw new Error("No Ethereum wallet is available for signing.");
          return evm.signTypedData(payload);
        },
      },
    };
  }, [evmRuntime, exposeParaSession, paraSession, svmWallet]);
  const signingSvmRuntime = useMemo<SvmWalletRuntime>(
    () => ({
      ...svmRuntime,
      execution: {
        ...svmRuntime.execution,
        signSolanaMessage: async (payload) => {
          const address =
            payload.signer ?? svmRuntime.identity(Date.now()).address;
          if (
            address &&
            exposeParaSession &&
            paraSession &&
            findParaSigningWallet(paraSession, address, "svm")?.id
          ) {
            if (!payload.message) throw new Error("Missing message payload");
            return signParaSolanaMessage(paraSession, address, payload.message);
          }
          if (!svmRuntime.execution.signSolanaMessage)
            throw new Error("No Solana wallet is available for signing.");
          return svmRuntime.execution.signSolanaMessage(payload);
        },
      },
    }),
    [svmRuntime, exposeParaSession, paraSession],
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
      svm={signingSvmRuntime}
      execution={executionRuntime}
      additionalEvmWalletOptions={providerEvmWalletOptions}
      transformEvmIdentity={transformEvmIdentity}
      transformAccounts={transformAccounts}
      canManageAccount={canManageParaAccount}
      supportedChains={evmRuntime.supportedChains}
    >
      {children}
    </AomiWalletKitComposer>
  );
}
