import { buildAccounts } from "@/wallet/accounts";
import type { AomiAccount, WalletFamily, WalletSource } from "@/wallet/types";
import { resolveGracefulEvmIdentity } from "./identity-grace";
import { findActiveConnection } from "./policy";
import { EVM_IDENTITY_GRACE_MS } from "./types";
import type {
  ActiveRef,
  RegistryConnection,
  WalletRegistryState,
} from "./types";

export function selectActiveEvm(
  state: WalletRegistryState,
): ActiveRef | undefined {
  return state.activeByFamily.evm;
}

export function selectSvm(
  state: WalletRegistryState,
): RegistryConnection | undefined {
  const active = state.activeByFamily.svm;
  if (active) {
    return state.connections.find(
      (connection) =>
        connection.family === "svm" &&
        connection.address === active.address &&
        (!active.uid || connection.uid === active.uid),
    );
  }
  return state.connections.find((connection) => connection.family === "svm");
}

function findActive(
  state: WalletRegistryState,
  family: WalletFamily,
): RegistryConnection | undefined {
  const active = state.activeByFamily[family];
  return active ? findActiveConnection(state.connections, active) : undefined;
}

export type EvmIdentity = {
  address?: string;
  chainId?: number;
  connectorId?: string;
  walletName?: string;
  walletSource?: WalletSource;
};

export function selectEvmIdentity(
  state: WalletRegistryState,
  now: number,
  selectedChainId?: number,
): EvmIdentity {
  const activeConnection = findActive(state, "evm");
  const walletSource: WalletSource | undefined =
    activeConnection?.kind === "embedded-session"
      ? "embedded"
      : activeConnection?.kind === "walletconnect"
        ? "walletconnect"
        : undefined;
  const current = activeConnection
    ? {
        address: activeConnection.address,
        chainId: activeConnection.chainId ?? selectedChainId,
        connectorId: activeConnection.uid,
        walletName: activeConnection.walletName,
        walletSource,
      }
    : selectedChainId === undefined
      ? {}
      : { chainId: selectedChainId };
  const explicitDisconnect = Boolean(
    state.evmGrace.last?.address &&
    state.intents.droppedAddresses.includes(
      state.evmGrace.last.address.toLowerCase(),
    ),
  );

  return resolveGracefulEvmIdentity({
    current,
    previous: state.evmGrace.last,
    selectedChainId,
    disconnectedAt: state.evmGrace.disconnectedAt,
    now,
    graceMs: EVM_IDENTITY_GRACE_MS,
    explicitDisconnect,
  }).identity;
}

export function selectSvmIdentity(
  state: WalletRegistryState,
  _now: number,
): {
  address?: string;
  walletName?: string;
} {
  const activeConnection = findActive(state, "svm") ?? selectSvm(state);
  return activeConnection
    ? {
        address: activeConnection.address,
        walletName: activeConnection.walletName,
      }
    : {};
}

export function selectAccounts(
  state: WalletRegistryState,
  family: WalletFamily,
  now: number,
  selectedChainId?: number,
): AomiAccount[] {
  const activeEvm = family === "evm" ? state.activeByFamily.evm : undefined;
  const evmIdentity =
    family === "evm" ? selectEvmIdentity(state, now, selectedChainId) : {};
  const evmConnections =
    family === "evm"
      ? state.connections
          .filter((connection) => connection.family === "evm")
          .map((connection) => ({
            id: connection.uid,
            walletName: connection.walletName ?? connection.stableId,
            address: connection.address,
            chainId: connection.chainId ?? selectedChainId,
            provider: connection.providerId,
            walletKind:
              connection.kind === "embedded-session"
                ? ("embedded" as const)
                : undefined,
            selected: connection.addresses[0] === connection.address,
          }))
      : [];

  if (evmIdentity.address && evmConnections.length === 0) {
    evmConnections.push({
      id: evmIdentity.connectorId ?? "cached-evm",
      walletName: evmIdentity.walletName ?? "Wallet",
      address: evmIdentity.address,
      chainId: evmIdentity.chainId,
      provider: undefined,
      walletKind: undefined,
      selected: true,
    });
  }

  const activeSvm = family === "svm" ? selectSvm(state) : undefined;
  const svmConnections =
    family === "svm"
      ? state.connections.filter((connection) => connection.family === "svm")
      : [];
  return buildAccounts({
    evmConnections,
    activeEvmAddress: evmIdentity.address,
    activeEvmConnectionId: activeEvm?.uid ?? evmIdentity.connectorId,
    svmConnections: svmConnections.map((connection) => ({
      id: connection.uid,
      publicKey: connection.address,
      walletName: connection.walletName,
      provider: connection.providerId,
      walletKind:
        connection.kind === "embedded-session" ? "embedded" : undefined,
    })),
    activeSvmAddress: activeSvm?.address,
  });
}
