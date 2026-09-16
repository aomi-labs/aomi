"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Chain } from "viem";
import type { Connector } from "wagmi";
import type { AomiAccount, AomiWalletOption } from "../../types";
import { selectAccounts, selectEvmIdentity } from "../../registry/selectors";
import type { WalletRegistryStore } from "../../registry/store";
import { useWalletRegistry } from "../../registry/use-wallet-registry";
import type { WalletRegistryState } from "../../registry/types";
import type { WalletRuntime } from "../../composer/types";
import {
  dedupeWalletOptions,
  detectEvmProviderBrand,
  toEvmWalletOption,
  useInstalledWalletFlags,
  walletOptionIsDetected,
} from "./brands";
import { canonicalWalletKey } from "../../catalog/wallet-branding";
import { planEvmAccountDisconnect } from "./disconnect-plan";
import { useWagmiRegistrySource } from "./registry-source";
import {
  useSafeCapabilities,
  useSafeConnect,
  useSafeConnections,
  useSafeConnectors,
  useSafeDisconnect,
  useSafeGetWalletClientFor,
  useSafeReconnect,
  useSafeSendCallsSync,
  useSafeSendTransaction,
  useSafeSignMessage,
  useSafeSignTypedData,
  useSafeSwitchAccount,
  useSafeSwitchChain,
  useSafeWagmiConfig,
  useSafeWalletClient,
} from "./safe-hooks";
import { walletDebug } from "../../wallet-debug";

export type EvmWalletRuntimeProviderHooks = {
  /**
   * Provider-owned account/session logout. The registry command is still named
   * `provider/logout` for compatibility, but the runtime only sees a generic
   * callback here.
   */
  providerLogout?: () => Promise<void>;
  /**
   * Called before connecting a provider-owned embedded wallet option. Hosted
   * providers use this to re-attach a session without making generic wagmi code
   * know about a specific SDK.
   */
  onProviderReconnectRequested?: (store: WalletRegistryStore) => void;
  /**
   * Called when a requested EVM wallet option cannot be matched to a concrete
   * wagmi connector. Hosted providers use this to open their auth modal.
   */
  onConnectFallback?: (store: WalletRegistryStore) => void;
  /**
   * Keep provider-owned connector rows out of normal external wallet lists.
   */
  isProviderInternalConnector?: (connector: Connector) => boolean;
  /**
   * Extra side effect after an EVM account disconnect plan runs. Hosted
   * providers use this only for debug/analytics around detached embedded
   * accounts.
   */
  onAccountDisconnectPlanned?: (
    plan: ReturnType<typeof planEvmAccountDisconnect>,
  ) => void;
  signMessageForProviderAccount?: (args: {
    connection: WalletRegistryState["connections"][number];
    message: string;
    chainId?: number;
  }) => Promise<`0x${string}` | null | undefined>;
};

export type EvmWalletRuntime = WalletRuntime<"evm"> & {
  registryStore: WalletRegistryStore;
  registryState: WalletRegistryState;
  activeEvmConnection?: WalletRegistryState["connections"][number];
  activeConnector?: Connector;
  capabilities?: ReturnType<typeof useSafeCapabilities>["capabilities"];
  chainsById: Record<number, Chain>;
  supportedChains: readonly Chain[];
  walletClient: ReturnType<typeof useSafeWalletClient>["walletClient"];
  getWalletClientFor: ReturnType<typeof useSafeGetWalletClientFor>;
  sendTransactionAsync: ReturnType<
    typeof useSafeSendTransaction
  >["sendTransactionAsync"];
  sendCallsSyncAsync: ReturnType<
    typeof useSafeSendCallsSync
  >["sendCallsSyncAsync"];
  signTypedDataAsync: ReturnType<
    typeof useSafeSignTypedData
  >["signTypedDataAsync"];
  signMessageAsync: ReturnType<typeof useSafeSignMessage>["signMessageAsync"];
  signMessageForAccount?: (args: {
    accountId: string;
    message: string;
    chainId?: number;
  }) => Promise<`0x${string}`>;
  switchChainAsync: ReturnType<typeof useSafeSwitchChain>["switchChainAsync"];
  isSwitchingChain: boolean;
  shouldUseExternalSigner: boolean;
};

async function findConnectorByProviderBrand(
  connectors: readonly Connector[],
  expectedKey: string,
  excludeUid?: string,
): Promise<Connector | undefined> {
  for (const connector of connectors) {
    if (connector.uid === excludeUid || !connector.getProvider) continue;
    try {
      const provider = await connector.getProvider();
      const brand = detectEvmProviderBrand(provider);
      if (brand && canonicalWalletKey(brand) === expectedKey) {
        return connector;
      }
    } catch {
      // Provider sniffing is best-effort; keep trying other connectors.
    }
  }
  return undefined;
}

function findActiveEvmConnection(
  state: WalletRegistryState,
): WalletRegistryState["connections"][number] | undefined {
  const active = state.activeByFamily.evm;
  if (!active) return undefined;
  return state.connections.find((connection) => {
    if (connection.family !== "evm") return false;
    if (active.uid && connection.uid === active.uid) return true;
    if (active.stableId && connection.stableId !== active.stableId) {
      return false;
    }
    return connection.address.toLowerCase() === active.address.toLowerCase();
  });
}

export function useEvmWalletRuntime({
  configuredChains,
  selectedEvmChainId,
  setSelectedEvmChainId,
  storageKey,
  providerHooks = {},
}: {
  configuredChains?: readonly Chain[];
  selectedEvmChainId?: number;
  setSelectedEvmChainId: (chainId: number | undefined) => void;
  storageKey: string;
  providerHooks?: EvmWalletRuntimeProviderHooks;
}): EvmWalletRuntime {
  const { walletClient } = useSafeWalletClient();
  const { switchChainAsync, isPending } = useSafeSwitchChain();
  const { disconnectAsync: wagmiDisconnectAsync } = useSafeDisconnect();
  const { reconnectAsync: wagmiReconnectAsync } = useSafeReconnect();
  const installedWalletFlags = useInstalledWalletFlags();
  const evmConnections = useSafeConnections();
  const evmConnectors = useSafeConnectors();
  const { connectAsync: wagmiConnectAsync } = useSafeConnect();
  const { switchAccountAsync } = useSafeSwitchAccount();
  const { sendTransactionAsync } = useSafeSendTransaction();
  const { sendCallsSyncAsync } = useSafeSendCallsSync();
  const { signTypedDataAsync } = useSafeSignTypedData();
  const { signMessageAsync } = useSafeSignMessage();
  const getWalletClientFor = useSafeGetWalletClientFor();
  const wagmiConfig = useSafeWagmiConfig();

  const registryExecutors = useMemo(
    () => ({
      async wagmiReconnect(stableIds: string[]) {
        if (!wagmiReconnectAsync) return;
        const targets: Connector[] = stableIds
          .map((stableId) =>
            evmConnectors.find((candidate) => candidate.id === stableId),
          )
          .filter((connector): connector is Connector => Boolean(connector));
        if (targets.length === 0) {
          walletDebug("registry:command-skip", {
            kind: "wagmi/reconnect",
            stableIds,
            reason: "connector-missing",
          });
          return;
        }
        const result = await wagmiReconnectAsync({
          connectors: targets,
        } as never);
        if (Array.isArray(result) && result.length === 0) {
          walletDebug("evm:heal", {
            action: "reconnect-empty",
            stableIds,
          });
        }
      },
      async wagmiConnect(stableId: string) {
        if (!wagmiConnectAsync) return;
        const target = evmConnectors.find(
          (candidate) => candidate.id === stableId,
        );
        if (!target) {
          walletDebug("registry:command-skip", {
            kind: "wagmi/connect",
            stableId,
            reason: "connector-missing",
          });
          return;
        }
        await wagmiConnectAsync({ connector: target });
      },
      async wagmiDisconnect(uid: string) {
        if (!wagmiDisconnectAsync) return;
        const target = wagmiConfig.connectors.find(
          (candidate) => candidate.uid === uid,
        );
        if (!target) {
          walletDebug("registry:command-skip", {
            kind: "wagmi/disconnect",
            uid,
            reason: "connector-missing",
          });
          return;
        }
        await wagmiDisconnectAsync({ connector: target });
      },
      providerLogout: providerHooks.providerLogout ?? (async () => undefined),
    }),
    [
      evmConnectors,
      providerHooks.providerLogout,
      wagmiConfig.connectors,
      wagmiConnectAsync,
      wagmiDisconnectAsync,
      wagmiReconnectAsync,
    ],
  );
  const { store: registryStore, state: registryState } = useWalletRegistry({
    executors: registryExecutors,
    storageKey,
  });
  useWagmiRegistrySource(registryStore);

  const supportedChains = useMemo(
    () => configuredChains ?? wagmiConfig.chains,
    [configuredChains, wagmiConfig.chains],
  );
  const chainsById = useMemo<Record<number, Chain>>(
    () => Object.fromEntries(supportedChains.map((chain) => [chain.id, chain])),
    [supportedChains],
  );
  const activeEvmConnection = useMemo(() => {
    const connection = findActiveEvmConnection(registryState);
    if (!connection || connection.chainId || !selectedEvmChainId) {
      return connection;
    }
    return { ...connection, chainId: selectedEvmChainId };
  }, [registryState, selectedEvmChainId]);
  const activeConnector = useMemo(() => {
    const active = registryState.activeByFamily.evm;
    if (!active?.uid) return undefined;
    return wagmiConfig.connectors.find(
      (candidate) => candidate.uid === active.uid,
    );
  }, [registryState.activeByFamily.evm, wagmiConfig.connectors]);
  const { capabilities } = useSafeCapabilities({
    account: activeEvmConnection?.address as `0x${string}` | undefined,
    connector: activeConnector,
    stableId: activeEvmConnection?.stableId,
    walletName: activeEvmConnection?.walletName,
  });
  const evmSwitchInFlightRef = useRef(false);

  useEffect(() => {
    const chainId = activeEvmConnection?.chainId;
    if (
      evmSwitchInFlightRef.current ||
      !chainId ||
      !chainsById[chainId] ||
      chainId === selectedEvmChainId
    ) {
      return;
    }
    walletDebug("evm:chain-external-sync", {
      chainId,
      previous: selectedEvmChainId ?? null,
    });
    setSelectedEvmChainId(chainId);
  }, [
    activeEvmConnection?.chainId,
    chainsById,
    selectedEvmChainId,
    setSelectedEvmChainId,
  ]);

  useEffect(() => {
    walletDebug("evm:connections-changed", {
      connections: evmConnections.map((conn) => ({
        connector: conn.connectorName,
        uid: conn.connectorId,
        address: conn.address,
      })),
    });
  }, [evmConnections]);

  const evmWalletOptions = useMemo(
    () =>
      dedupeWalletOptions(
        evmConnectors
          .map((connector) =>
            toEvmWalletOption(connector, installedWalletFlags),
          )
          .filter((option) => {
            const connector = evmConnectors.find(
              (candidate) => candidate.uid === option.id,
            );
            if (
              connector &&
              providerHooks.isProviderInternalConnector?.(connector)
            ) {
              return false;
            }
            return walletOptionIsDetected(option);
          }),
      ),
    [evmConnectors, installedWalletFlags, providerHooks],
  );

  const selectAccount = useCallback(
    async (id: string) => {
      const connection = registryStore
        .getSnapshot()
        .connections.find((conn) => conn.family === "evm" && conn.uid === id);
      if (!connection) return;
      registryStore.dispatch({
        type: "user/select-active",
        family: "evm",
        address: connection.address,
        uid: connection.uid,
        stableId: connection.stableId,
        now: Date.now(),
      });
      if (!switchAccountAsync) return;
      const connector = wagmiConfig.connectors.find(
        (candidate) => candidate.uid === connection.uid,
      );
      if (!connector) {
        walletDebug("active-evm:switch-skipped", {
          uid: connection.uid,
          stableId: connection.stableId,
          reason: "connector-missing",
        });
        return;
      }
      try {
        await switchAccountAsync({ connector });
      } catch (error) {
        walletDebug("active-evm:cosmetic-switch-failed", {
          uid: connection.uid,
          stableId: connection.stableId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [registryStore, switchAccountAsync, wagmiConfig.connectors],
  );

  const signMessageForAccount = useCallback(
    async ({
      accountId,
      chainId,
      message,
    }: {
      accountId: string;
      message: string;
      chainId?: number;
    }): Promise<`0x${string}`> => {
      const connection = registryStore
        .getSnapshot()
        .connections.find(
          (conn) => conn.family === "evm" && conn.uid === accountId,
        );
      if (!connection) {
        throw new Error(`Unknown EVM account: ${accountId}`);
      }
      const connector = wagmiConfig.connectors.find(
        (candidate) => candidate.uid === connection.uid,
      );
      if (
        !connector ||
        providerHooks.isProviderInternalConnector?.(connector)
      ) {
        const providerSignature =
          await providerHooks.signMessageForProviderAccount?.({
            connection,
            message,
            chainId,
          });
        if (providerSignature) {
          return providerSignature;
        }
      }
      if (!connector) {
        throw new Error("Wallet linking requires the target wallet connector");
      }
      const walletClient = (await getWalletClientFor({
        connector,
      })) as {
        signMessage?: (args: unknown) => Promise<string>;
      } | null;
      if (walletClient?.signMessage) {
        return (await walletClient.signMessage({
          account: connection.address as `0x${string}`,
          message,
        } as never)) as `0x${string}`;
      }
      if (!signMessageAsync) {
        throw new Error("Wallet linking requires an active EVM signer");
      }
      await selectAccount(accountId);
      return (await signMessageAsync({
        account: connection.address as `0x${string}`,
        connector,
        message,
      } as never)) as `0x${string}`;
    },
    [
      getWalletClientFor,
      providerHooks,
      registryStore,
      selectAccount,
      signMessageAsync,
      wagmiConfig.connectors,
    ],
  );

  const connect = useCallback(
    async (id?: string) => {
      if (!id) {
        providerHooks.onConnectFallback?.(registryStore);
        return;
      }
      const connectorOptions = evmConnectors.map((candidate) => ({
        connector: candidate,
        option: toEvmWalletOption(candidate, installedWalletFlags),
      }));
      const normalizedId = canonicalWalletKey(id);
      let target =
        connectorOptions.find(
          ({ option, connector }) => option.id === id || connector.uid === id,
        )?.connector ??
        connectorOptions.find(({ connector }) => connector.id === id)
          ?.connector ??
        connectorOptions.find(({ option, connector }) => {
          if (canonicalWalletKey(option.label) !== normalizedId) return false;
          if (providerHooks.isProviderInternalConnector?.(connector)) {
            return false;
          }
          return true;
        })?.connector;
      if (target?.getProvider) {
        try {
          const provider = await target.getProvider();
          const actualKey = canonicalWalletKey(
            detectEvmProviderBrand(provider) ?? "",
          );
          if (actualKey && actualKey !== normalizedId) {
            const replacement = await findConnectorByProviderBrand(
              connectorOptions.map(({ connector }) => connector),
              normalizedId,
              target.uid,
            );
            if (replacement) {
              walletDebug("evm:connect-brand-mismatch", {
                requested: id,
                selected: target.id,
                actual: actualKey,
                replacement: replacement.id,
              });
              target = replacement;
            }
          }
        } catch (error) {
          walletDebug("evm:connect-brand-sniff-failed", {
            requested: id,
            connector: target.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (target && wagmiConnectAsync) {
        walletDebug("evm:connect-target", {
          requested: id,
          connector: target.name,
          uid: target.uid,
          stableId: target.id,
        });
        if (providerHooks.isProviderInternalConnector?.(target)) {
          providerHooks.onProviderReconnectRequested?.(registryStore);
        }
        const result = await wagmiConnectAsync({ connector: target });
        const connectedAddress = (
          result as { accounts?: readonly string[] } | undefined
        )?.accounts?.find((account) => account.startsWith("0x"));
        if (connectedAddress) {
          registryStore.dispatch({
            type: "user/connect-succeeded",
            family: "evm",
            address: connectedAddress,
            uid: target.uid,
            stableId: target.id,
            now: Date.now(),
          });
        }
        return;
      }
      providerHooks.onProviderReconnectRequested?.(registryStore);
      providerHooks.onConnectFallback?.(registryStore);
    },
    [
      evmConnectors,
      installedWalletFlags,
      providerHooks,
      registryStore,
      wagmiConnectAsync,
    ],
  );

  const disconnectAccount = useCallback(
    async (target: AomiAccount) => {
      const disconnectPlan = planEvmAccountDisconnect({
        target,
        connections: evmConnections,
      });
      walletDebug("evm:account-sign-out", {
        wallet: target.walletName ?? null,
        address: disconnectPlan.targetAddress,
        isProviderOwnedAccount: disconnectPlan.isProviderOwnedAccount,
        disconnecting: [...disconnectPlan.connectorIds],
        othersRemain: disconnectPlan.otherConnectionsRemain,
        sameAddressRemains: disconnectPlan.sameAddressConnectionsRemain,
      });
      registryStore.dispatch({
        type: "user/disconnect-account",
        address: disconnectPlan.targetAddress,
        uids: [...disconnectPlan.connectorIds],
        isProviderOwnedAccount: disconnectPlan.isProviderOwnedAccount,
        othersRemain: disconnectPlan.otherConnectionsRemain,
        markDroppedAddress: disconnectPlan.shouldMarkDroppedAddress,
        now: Date.now(),
      });
      providerHooks.onAccountDisconnectPlanned?.(disconnectPlan);
    },
    [evmConnections, providerHooks, registryStore],
  );

  const disconnect = useCallback(
    async (accountId?: string) => {
      if (accountId) {
        const target = selectAccounts(
          registryStore.getSnapshot(),
          "evm",
          Date.now(),
          selectedEvmChainId,
        ).find((account) => account.id === accountId);
        if (target) await disconnectAccount(target);
        return;
      }
      registryStore.dispatch({
        type: "user/disconnect-family",
        family: "evm",
        now: Date.now(),
      });
    },
    [disconnectAccount, registryStore, selectedEvmChainId],
  );

  const selectNetwork = useCallback(
    async (networkId: string | number) => {
      const chainId = Number(networkId);
      if (!Number.isFinite(chainId)) return;
      setSelectedEvmChainId(chainId);
      if (
        switchChainAsync &&
        activeConnector &&
        activeEvmConnection?.chainId !== chainId
      ) {
        evmSwitchInFlightRef.current = true;
        try {
          await switchChainAsync({
            chainId,
            connector: activeConnector,
          });
        } finally {
          evmSwitchInFlightRef.current = false;
        }
      }
    },
    [
      activeConnector,
      activeEvmConnection?.chainId,
      setSelectedEvmChainId,
      switchChainAsync,
    ],
  );

  const selectRuntimeAccounts = useCallback(
    (now: number) =>
      selectAccounts(registryState, "evm", now, selectedEvmChainId),
    [registryState, selectedEvmChainId],
  );
  const selectRuntimeEvmIdentity = useCallback(
    (now: number) => selectEvmIdentity(registryState, now, selectedEvmChainId),
    [registryState, selectedEvmChainId],
  );

  const activeConnectorIsProviderInternal = activeConnector
    ? providerHooks.isProviderInternalConnector?.(activeConnector)
    : false;

  return {
    registryStore,
    registryState,
    status: "ready",
    activeEvmConnection,
    activeConnector,
    capabilities,
    chainsById,
    supportedChains,
    walletClient,
    getWalletClientFor,
    sendTransactionAsync,
    sendCallsSyncAsync,
    signTypedDataAsync,
    signMessageAsync,
    signMessageForAccount,
    switchChainAsync,
    isSwitchingChain: isPending,
    activeAccount: selectRuntimeAccounts(Date.now()).find(
      (account) => account.active,
    ),
    options: evmWalletOptions,
    shouldUseExternalSigner: Boolean(
      activeConnector && !activeConnectorIsProviderInternal,
    ),
    identity: selectRuntimeEvmIdentity,
    accounts: selectRuntimeAccounts,
    selectAccount,
    connect,
    disconnect,
    selectNetwork,
  };
}
