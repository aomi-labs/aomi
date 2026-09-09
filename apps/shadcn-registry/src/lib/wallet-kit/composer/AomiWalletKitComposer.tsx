"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@aomi-labs/react";
import { AomiWalletKitContextProvider } from "../context";
import type { AomiAccount, AomiWalletKit } from "../types";
import { EVM_IDENTITY_GRACE_MS, REGISTRY_STORAGE_KEY } from "../registry/types";
import { walletDebug } from "../wallet-debug";
import { DISABLED_ACCOUNT_RUNTIME } from "../account/disabled-runtime";
import { buildWalletKitAccounts } from "../accounts";
import { buildWalletKitIdentity } from "./build-identity";
import { buildWalletKitActions } from "./build-wallet-kit-actions";
import { mergeWalletRows } from "./merge-wallet-rows";
import type { AomiWalletKitComposerProps } from "./types";

export function AomiWalletKitComposer({
  children,
  auth,
  evm,
  svm,
  execution,
  account = DISABLED_ACCOUNT_RUNTIME,
  additionalEvmWalletOptions = [],
  transformEvmIdentity,
  transformAccounts,
  canManageAccount,
  supportedChains,
}: AomiWalletKitComposerProps) {
  const { user } = useUser();
  const [evmIdentityGraceVersion, bumpEvmIdentityGrace] = useState(0);
  const { registryStore, registryState } = evm;

  const registryEvmIdentity = useMemo(() => {
    const identity = evm.identity(Date.now());
    return transformEvmIdentity ? transformEvmIdentity(identity) : identity;
  }, [evmIdentityGraceVersion, evm, transformEvmIdentity]);

  const gracefulEvmIdentity = {
    identity: registryEvmIdentity,
    disconnectedAt: registryState.evmGrace.disconnectedAt,
    usingCachedIdentity: Boolean(
      registryState.evmGrace.disconnectedAt && registryEvmIdentity.address,
    ),
  };

  useEffect(() => {
    if (
      !gracefulEvmIdentity.usingCachedIdentity ||
      gracefulEvmIdentity.disconnectedAt === null
    ) {
      return;
    }

    const elapsed = Date.now() - gracefulEvmIdentity.disconnectedAt;
    const timeout = window.setTimeout(
      () => bumpEvmIdentityGrace((version) => version + 1),
      Math.max(0, EVM_IDENTITY_GRACE_MS - elapsed) + 1,
    );
    return () => window.clearTimeout(timeout);
  }, [
    gracefulEvmIdentity.disconnectedAt,
    gracefulEvmIdentity.usingCachedIdentity,
  ]);

  useEffect(() => {
    if (registryState.phase !== "stable") return;
    const registryAddress =
      registryState.activeByFamily.evm?.address.toLowerCase() ?? null;
    const liveAddress =
      gracefulEvmIdentity.identity.address?.toLowerCase() ?? null;
    if (registryAddress === liveAddress) return;
    walletDebug("registry:shadow-diff", {
      registryAddress,
      liveAddress,
      registryActive: registryState.activeByFamily.evm,
    });
  }, [
    gracefulEvmIdentity.identity.address,
    registryState.activeByFamily.evm,
    registryState.phase,
  ]);

  const adapter = useMemo<AomiWalletKit>(() => {
    const address = gracefulEvmIdentity.identity.address;
    const effectiveChainId = gracefulEvmIdentity.identity.chainId;
    const svmIdentity = svm?.identity(Date.now());
    const registryEvmConnected = registryState.connections.some(
      (connection) => connection.family === "evm",
    );
    const isConnected = Boolean(
      auth.status === "authenticated" ||
      registryEvmConnected ||
      address ||
      svmIdentity?.address,
    );
    const isBooting = auth.status === "booting" && !isConnected;
    const solanaWalletDescriptors =
      svm?.options.map((option) => ({
        name: option.label,
        installed: Boolean(option.installed),
        ready: option.ready !== false && option.status !== "unavailable",
        iconUrl: option.iconUrl,
      })) ?? [];
    const accounts = buildWalletKitAccounts({
      accounts: [
        ...evm.accounts(Date.now()),
        ...(svm?.accounts(Date.now()) ?? []),
      ],
      accountWallets: account.wallets,
      transformAccounts,
      canManageAccount,
    });
    const evmWalletOptions = [...evm.options, ...additionalEvmWalletOptions];
    const svmWalletOptions =
      svm?.options.map((option) => ({
        ...option,
        family: "svm" as const,
        kind: "solana" as const,
      })) ?? [];
    const walletModalRows = mergeWalletRows({
      accounts,
      storedWallets: account.wallets,
      canLinkWallet: Boolean(account.linkWallet) && account.status === "ready",
      auth,
      options: [...evmWalletOptions, ...svmWalletOptions, ...auth.methods],
    });
    const actions = buildWalletKitActions({
      accounts,
      auth,
      evm,
      svm,
      execution,
      registryStore,
      evmAddress: address,
      registryEvmConnected,
      svmIdentity,
    });
    const hasAnyDisconnectablePath = Boolean(
      registryState.connections.length > 0 || svmIdentity?.address,
    );
    const identity = buildWalletKitIdentity({
      auth,
      address,
      chainId: effectiveChainId ?? undefined,
      isBooting,
      isConnected,
      svm,
      walletName: gracefulEvmIdentity.identity.walletName,
      walletSource: gracefulEvmIdentity.identity.walletSource,
    });
    return {
      identity,
      isReady: !isBooting,
      isSwitchingChain: evm.isSwitchingChain,
      canConnect:
        Boolean(auth.canOpenModal) ||
        Boolean(solanaWalletDescriptors.length) ||
        Boolean(evmWalletOptions.length),
      canOpenAccountUI:
        Boolean(auth.openAccountUI) &&
        auth.status === "authenticated" &&
        identity.isConnected,
      canDisconnect: hasAnyDisconnectablePath,
      accounts,
      walletModalRows,
      accountStatus: account.status,
      accountError: account.error,
      accountGuest: account.guest,
      // Temporary Better Auth guests are a transport principal, never an
      // account-management principal. Keep that boundary at the adapter too,
      // so stale or non-canonical account responses cannot expose guest chrome.
      accountUser: account.guest ? undefined : account.user,
      accountLinkedAccounts: account.guest ? [] : account.linkedAccounts,
      accountWallets: account.guest ? [] : account.wallets,
      signOutAccount: account.signOut,
      deleteAccount: account.deleteAccount,
      updateAccount: account.updateAccount,
      linkWallet: account.linkWallet,
      updateLinkedAccount: account.updateAuthIdentity,
      updateLinkedWallet: account.updateWallet,
      unlinkLinkedWallet: account.unlinkWallet,
      unlinkLinkedAccount: account.unlinkAuthIdentity,
      selectAccount: actions.selectAccount,
      evmWallets: evmWalletOptions,
      connectEvmWallet: actions.connectEvmWallet,
      socialLoginOptions: auth.methods,
      connectSocial: actions.connectSocial,
      solanaWallets: solanaWalletDescriptors,
      connectSolanaWallet: actions.connectSolanaWallet,
      supportedChains,
      supportedNetworks: {
        evm: supportedChains,
        solana: svm?.supportedNetworks ?? [],
      },
      selectedSolanaNetwork: svm?.selectedNetwork,
      solanaNetworkSwitchRequiresReconnect: Boolean(svmIdentity?.address),
      connect: actions.connect,
      disconnect: actions.disconnect,
      openAccountUI: actions.openAccountUI,
      switchChain: actions.switchChain,
      selectNetwork: actions.selectNetwork,
      sendTransaction: execution.evm.sendTransaction,
      signTypedData: execution.evm.signTypedData,
      canSignFor: execution.canSignFor,
      signMessage: execution.evm.signMessage,
      getAccountCredential:
        auth.status === "authenticated" ? auth.getCredential : undefined,
      getAccountBearer: account.getAccountBearer,
      signSolanaTransaction: svm?.execution.signSolanaTransaction,
      signSolanaMessage: svm?.execution.signSolanaMessage,
      sendSolanaTransaction: svm?.execution.sendSolanaTransaction,
      signAndSendSolanaTransaction: svm?.execution.signAndSendSolanaTransaction,
      solanaRpcHttpUrl: svm?.execution.solanaRpcHttpUrl,
      solanaRpcWsUrl: svm?.execution.solanaRpcWsUrl,
    };
  }, [
    auth,
    account.wallets,
    account.linkedAccounts,
    account.status,
    account.error,
    account.guest,
    account.deleteAccount,
    account.updateAccount,
    account.linkWallet,
    account.updateAuthIdentity,
    account.unlinkWallet,
    account.unlinkAuthIdentity,
    account.updateWallet,
    account.user,
    account.getAccountBearer,
    additionalEvmWalletOptions,
    canManageAccount,
    evm,
    execution,
    gracefulEvmIdentity.identity.address,
    gracefulEvmIdentity.identity.chainId,
    gracefulEvmIdentity.identity.walletName,
    registryStore,
    svm,
    supportedChains,
    transformAccounts,
  ]);

  return (
    <AomiWalletKitContextProvider value={adapter}>
      {children}
    </AomiWalletKitContextProvider>
  );
}
