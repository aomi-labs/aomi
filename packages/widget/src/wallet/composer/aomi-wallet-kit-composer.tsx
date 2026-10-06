"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AomiWalletKitContextProvider } from "@/wallet/context";
import type { AomiAccount, AomiWalletKit } from "@/wallet/types";
import { EVM_IDENTITY_GRACE_MS } from "@/wallet/registry/types";
import { walletDebug } from "@/wallet/wallet-debug";
import { DISABLED_ACCOUNT_RUNTIME } from "@/wallet/account/disabled-runtime";
import { buildWalletKitAccounts } from "@/wallet/accounts";
import { buildWalletKitIdentity } from "./build-identity";
import { buildWalletKitActions } from "./build-wallet-kit-actions";
import type { AomiWalletKitComposerProps } from "./types";
import { resolveWalletState } from "./wallet-state";
import {
  readWalletSelection,
  selectedWalletKeys,
  writeWalletSelection,
} from "./wallet-selection";
import { preferenceStorage, useWidgetStorage } from "@/lib/widget-storage";
import { useWalletAuthPublisher } from "@/wallet/providers/auth-store";
import { walletKey } from "@/wallet/wallet-utils";

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
  const [evmIdentityGraceVersion, bumpEvmIdentityGrace] = useState(0);
  const { registryStore, registryState } = evm;
  const accountId = account.guest ? undefined : account.user?.id;
  const [selectionVersion, setSelectionVersion] = useState(0);
  const storage = useWidgetStorage();
  const selectionStorage = useMemo(() => preferenceStorage(storage), [storage]);
  const storedSelection = useMemo(
    () => readWalletSelection(selectionStorage, accountId),
    [accountId, selectionStorage, selectionVersion],
  );

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

  const accounts = useMemo(
    () =>
      buildWalletKitAccounts({
        accounts: [
          ...evm.accounts(Date.now()),
          ...(svm?.accounts(Date.now()) ?? []),
        ],
        accountWallets: account.wallets,
        transformAccounts,
        canManageAccount,
      }),
    [account.wallets, canManageAccount, evm, svm, transformAccounts],
  );
  const selection = useMemo(
    () =>
      selectedWalletKeys(
        storedSelection,
        registryState.activeByFamily,
        accountId ? account.wallets : undefined,
      ),
    [account.wallets, accountId, registryState.activeByFamily, storedSelection],
  );
  const mountedProviders = useMemo(
    () =>
      [...new Set([auth.provider, auth.sessionProvider, auth.embeddedProvider])]
        .filter((provider): provider is string => Boolean(provider))
        .filter((provider) => provider !== "none"),
    [auth.embeddedProvider, auth.provider, auth.sessionProvider],
  );
  const walletState = useMemo(
    () =>
      resolveWalletState({
        account:
          account.guest || account.status === "disabled"
            ? null
            : account.user
              ? {
                  id: account.user.id,
                  status:
                    account.status === "ready"
                      ? "ready"
                      : account.status === "error"
                        ? "error"
                        : "loading",
                }
              : auth.status === "authenticated"
                ? {
                    id: "pending",
                    status:
                      account.status === "error"
                        ? ("error" as const)
                        : ("loading" as const),
                  }
                : null,
        linked: account.wallets
          .filter((wallet) => wallet.kind !== "smart_account")
          .map((wallet) => ({
            id: wallet.id,
            family: wallet.family,
            address: wallet.address,
            kind: wallet.kind === "embedded" ? "embedded" : "external",
            provider: wallet.provider,
            chainId: wallet.chainId,
            label: wallet.label,
            capability: wallet.capability,
          })),
        connections: accounts
          .filter((connection) => connection.walletKind !== "smart_account")
          .map((connection) => ({
            id: connection.id,
            family: connection.family,
            address: connection.address,
            kind:
              connection.walletKind === "embedded" ? "embedded" : "external",
            provider: connection.provider,
            chainId: connection.chainId,
            walletName: connection.walletName,
            label: connection.label,
            capability: connection.capability,
            manageable: connection.manageable,
            providerActions: connection.actions,
            signerReady:
              connection.walletKind !== "embedded" ||
              execution.canSignFor?.(connection.family, connection.address) ===
                true,
            signerSelectable:
              connection.walletKind === "embedded" &&
              execution.canSelectFor?.(
                connection.family,
                connection.address,
              ) === true,
          })),
        mountedProviders,
        providerSettled: execution.providerSettled,
        selection,
      }),
    [
      account.guest,
      account.guestUserId,
      account.status,
      account.user,
      account.wallets,
      accounts,
      auth.status,
      execution,
      mountedProviders,
      selection,
    ],
  );

  useEffect(() => {
    if (!accountId) return;
    let changed = false;
    for (const family of walletState.clearSelection) {
      writeWalletSelection(selectionStorage, accountId, family, undefined);
      changed = true;
    }
    for (const family of ["evm", "svm"] as const) {
      if (
        walletState.persist[family] &&
        storedSelection[family] !== walletState.persist[family]
      ) {
        writeWalletSelection(
          selectionStorage,
          accountId,
          family,
          walletState.persist[family],
        );
        changed = true;
      }
    }
    if (changed) setSelectionVersion((version) => version + 1);
  }, [
    accountId,
    selectionStorage,
    storedSelection,
    walletState.clearSelection,
    walletState.persist,
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
    const operatingEvm = walletState.wallets.find(
      (wallet) => wallet.family === "evm" && wallet.operating,
    );
    const operatingSvm = walletState.wallets.find(
      (wallet) => wallet.family === "svm" && wallet.operating,
    );
    const address = operatingEvm?.address;
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
    const evmWalletOptions = [...evm.options, ...additionalEvmWalletOptions];
    const svmWalletOptions =
      svm?.options.map((option) => ({
        ...option,
        family: "svm" as const,
        kind: "solana" as const,
      })) ?? [];
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
      evmWallet: operatingEvm,
      svmWallet: operatingSvm,
      isBooting,
      isConnected,
      svm,
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
      wallets: walletState.wallets,
      accountStatus: account.status,
      accountError: account.error,
      accountConflict: account.conflict,
      accountGuest: account.guest,
      accountGuestUserId: account.guest ? account.guestUserId : undefined,
      // Temporary Better Auth guests are a transport principal, never an
      // account-management principal. Keep that boundary at the adapter too,
      // so stale or non-canonical account responses cannot expose guest chrome.
      accountUser: account.guest ? undefined : account.user,
      accountLinkedAccounts: account.guest ? [] : account.linkedAccounts,
      accountWallets: account.guest ? [] : account.wallets,
      signOutAccount: account.signOut,
      deleteAccount: account.deleteAccount,
      updateAccount: account.updateAccount,
      linkWallet: account.linkWallet
        ? async (input) => {
            await account.linkWallet!(input);
            if (!accountId) return;
            writeWalletSelection(
              selectionStorage,
              accountId,
              input.family,
              walletKey(input.family, input.address),
            );
            setSelectionVersion((version) => version + 1);
          }
        : undefined,
      updateLinkedAccount: account.updateAuthIdentity,
      updateLinkedWallet: account.updateWallet,
      unlinkLinkedWallet: account.unlinkWallet,
      unlinkLinkedAccount: account.unlinkAuthIdentity,
      selectAccount: async (id) => {
        const selected = accounts.find((candidate) => candidate.id === id);
        await actions.selectAccount(id);
        if (!selected || !accountId) return;
        writeWalletSelection(
          selectionStorage,
          accountId,
          selected.family,
          walletKey(selected.family, selected.address),
        );
        setSelectionVersion((version) => version + 1);
      },
      evmWallets: evmWalletOptions,
      connectEvmWallet: actions.connectEvmWallet,
      socialLoginOptions: auth.methods,
      // An external signer can stay ready while the selected auth SDK boots.
      // Publish its login capability only when that SDK can consume the intent.
      connectSocial:
        auth.status !== "booting" && auth.login
          ? actions.connectSocial
          : undefined,
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
      preparePreparedEvmTransaction:
        execution.evm.preparePreparedEvmTransaction,
      sendPreparedEvmTransaction: execution.evm.sendPreparedEvmTransaction,
      signEvmTransaction: execution.evm.signEvmTransaction,
      signTypedData: execution.evm.signTypedData,
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
    account.conflict,
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
    accountId,
    accounts,
    evm,
    execution,
    gracefulEvmIdentity.identity.address,
    walletState.wallets,
    registryStore,
    selectionStorage,
    svm,
    supportedChains,
  ]);

  const publish = useWalletAuthPublisher();
  useLayoutEffect(() => {
    publish?.(adapter);
  }, [publish, adapter]);

  return (
    <AomiWalletKitContextProvider value={adapter}>
      {children}
    </AomiWalletKitContextProvider>
  );
}
