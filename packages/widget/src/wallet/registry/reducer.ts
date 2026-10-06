import { resolveActive, countPlannedHealConnects } from "./policy";
import type {
  ActiveRef,
  EmbeddedSessionState,
  PersistedRegistryV1,
  RegistryConnection,
  RegistryConnectionOrderItem,
  RegistryEvent,
  WalletRegistryState,
} from "./types";
import { POPUP_REATTACH_BUDGET, REATTACH_SUPPRESSION_MS } from "./types";

export function createInitialState(): WalletRegistryState {
  return {
    phase: "booting",
    connections: [],
    connectionOrder: [],
    activeByFamily: {},
    intents: {
      droppedAddresses: [],
      providerSessionDetached: false,
      explicitFamilyDisconnect: {},
      pendingSvmWallet: null,
      preferEmbeddedOnConnect: false,
    },
    heal: {
      expected: [],
      reattachBudget: POPUP_REATTACH_BUDGET,
      suppressedUntil: null,
      suppressionReason: null,
    },
    evmGrace: {
      last: null,
      disconnectedAt: null,
    },
    embeddedSession: {
      up: false,
      providerId: null,
      uid: null,
      stableId: null,
      walletName: null,
      embeddedEvmAddress: null,
      chainId: null,
    },
  };
}

function normalizeAddress(
  family: RegistryConnectionOrderItem["family"],
  address: string,
): string {
  return family === "evm" ? address.toLowerCase() : address;
}

function connectionOrderItem(
  connection: RegistryConnection,
): RegistryConnectionOrderItem {
  return {
    family: connection.family,
    stableId: connection.stableId,
    address: normalizeAddress(connection.family, connection.address),
  };
}

function connectionOrderKey(item: RegistryConnectionOrderItem): string {
  return `${item.family}:${item.stableId}:${normalizeAddress(
    item.family,
    item.address,
  )}`;
}

function reconcileConnectionOrder(
  previous: readonly RegistryConnectionOrderItem[],
  connections: readonly RegistryConnection[],
): RegistryConnectionOrderItem[] {
  const liveKeys = new Set(connections.map((connection) =>
    connectionOrderKey(connectionOrderItem(connection)),
  ));
  const next: RegistryConnectionOrderItem[] = [];
  const seen = new Set<string>();

  for (const item of previous) {
    const key = connectionOrderKey(item);
    if (!liveKeys.has(key) || seen.has(key)) continue;
    next.push({
      ...item,
      address: normalizeAddress(item.family, item.address),
    });
    seen.add(key);
  }

  for (const connection of connections) {
    const item = connectionOrderItem(connection);
    const key = connectionOrderKey(item);
    if (seen.has(key)) continue;
    next.push(item);
    seen.add(key);
  }

  return next;
}

function applyConnectionOrder(
  connections: readonly RegistryConnection[],
  order: readonly RegistryConnectionOrderItem[],
): RegistryConnection[] {
  if (connections.length < 2) return [...connections];
  const byKey = new Map<string, RegistryConnection[]>();
  for (const connection of connections) {
    const key = connectionOrderKey(connectionOrderItem(connection));
    const bucket = byKey.get(key);
    if (bucket) bucket.push(connection);
    else byKey.set(key, [connection]);
  }

  const ordered: RegistryConnection[] = [];
  for (const item of order) {
    const key = connectionOrderKey(item);
    const bucket = byKey.get(key);
    if (!bucket?.length) continue;
    ordered.push(...bucket);
    byKey.delete(key);
  }
  for (const connection of connections) {
    const key = connectionOrderKey(connectionOrderItem(connection));
    const bucket = byKey.get(key);
    if (!bucket?.length) continue;
    ordered.push(...bucket);
    byKey.delete(key);
  }
  return ordered;
}

function withConnectionOrder(state: WalletRegistryState): WalletRegistryState {
  const baseOrder =
    state.connectionOrder.length > 0
      ? state.connectionOrder
      : state.connections.map(connectionOrderItem);
  const connectionOrder = reconcileConnectionOrder(baseOrder, state.connections);
  return {
    ...state,
    connectionOrder,
    connections: applyConnectionOrder(state.connections, connectionOrder),
  };
}

function activeFromPersisted(
  persisted: PersistedRegistryV1 | null,
): WalletRegistryState["activeByFamily"] {
  if (!persisted) return {};
  const active: WalletRegistryState["activeByFamily"] = {};
  if (persisted.active.evm?.address) {
    active.evm = {
      family: "evm",
      address: persisted.active.evm.address.toLowerCase(),
      stableId: persisted.active.evm.stableId,
    };
  }
  const persistedSvm =
    persisted.active.svm ??
    (persisted.active as typeof persisted.active & {
      solana?: { address: string; stableId?: string };
    }).solana;
  if (persistedSvm?.address) {
    active.svm = {
      family: "svm",
      address: persistedSvm.address,
      stableId: persistedSvm.stableId,
    };
  }
  return active;
}

function classifyConnection(
  connection: Omit<RegistryConnection, "key" | "kind">,
  embeddedSession: EmbeddedSessionState,
): RegistryConnection {
  const stableId = connection.stableId;
  const kind =
    connection.family === "svm"
      ? "svm"
      : stableId === embeddedSession.stableId
        ? "embedded-session"
        : stableId === "walletConnect"
          ? "walletconnect"
          : "external-evm";
  const address =
    connection.family === "evm"
      ? connection.address.toLowerCase()
      : connection.address;

  return {
    ...connection,
    key: `${connection.family}:${connection.uid}`,
    kind,
    address,
    addresses:
      connection.family === "evm"
        ? connection.addresses.map((item) => item.toLowerCase())
        : connection.addresses,
  };
}

function withResolvedActive(
  state: WalletRegistryState,
  families: ReadonlyArray<"evm" | "svm"> = ["evm", "svm"],
): WalletRegistryState {
  const activeByFamily = { ...state.activeByFamily };
  for (const family of families) {
    const active = resolveActive(state, family);
    if (active) activeByFamily[family] = active;
    else delete activeByFamily[family];
  }
  return { ...state, activeByFamily };
}

function currentActiveEvmConnection(
  state: WalletRegistryState,
): RegistryConnection | undefined {
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

function isSyntheticEmbeddedSessionConnection(
  state: WalletRegistryState,
  connection: RegistryConnection,
): boolean {
  return (
    connection.kind === "embedded-session" &&
    Boolean(state.embeddedSession.uid) &&
    connection.uid === state.embeddedSession.uid
  );
}

function withoutSyntheticEmbeddedSessionConnection(
  state: WalletRegistryState,
  connections: readonly RegistryConnection[],
): RegistryConnection[] {
  return connections.filter(
    (connection) => !isSyntheticEmbeddedSessionConnection(state, connection),
  );
}

function hasEmbeddedSessionIdentity(
  session: EmbeddedSessionState,
): session is EmbeddedSessionState & {
  uid: string;
  stableId: string;
  walletName: string;
  embeddedEvmAddress: string;
} {
  return Boolean(
    session.up &&
    session.uid &&
    session.stableId &&
    session.walletName &&
    session.embeddedEvmAddress,
  );
}

function withEmbeddedSessionConnection(
  state: WalletRegistryState,
): WalletRegistryState {
  const connections = withoutSyntheticEmbeddedSessionConnection(
    state,
    state.connections,
  );
  const session = state.embeddedSession;
  if (
    !hasEmbeddedSessionIdentity(session) ||
    state.intents.providerSessionDetached
  ) {
    return withConnectionOrder({ ...state, connections });
  }
  const address = session.embeddedEvmAddress.toLowerCase();
  const hasLiveEmbeddedConnection = connections.some(
    (connection) =>
      connection.family === "evm" &&
      connection.stableId === session.stableId &&
      connection.address.toLowerCase() === address.toLowerCase(),
  );
  if (hasLiveEmbeddedConnection) {
    return withConnectionOrder({ ...state, connections });
  }
  return withConnectionOrder({
    ...state,
    connections: [
      ...connections,
      {
        key: `evm:${session.uid}`,
        family: "evm",
        uid: session.uid,
        stableId: session.stableId,
        kind: "embedded-session",
        address,
        addresses: [address],
        chainId: session.chainId ?? undefined,
        walletName: session.walletName,
        providerId: session.providerId ?? undefined,
      },
    ],
  });
}

function withPreferredEmbeddedSessionActive(
  state: WalletRegistryState,
): WalletRegistryState {
  if (!state.intents.preferEmbeddedOnConnect) return state;
  const embedded = state.connections.find(
    (connection) =>
      connection.family === "evm" && connection.kind === "embedded-session",
  );
  if (!embedded) return state;
  return {
    ...state,
    activeByFamily: {
      ...state.activeByFamily,
      evm: {
        family: "evm",
        address: embedded.address,
        uid: embedded.uid,
        stableId: embedded.stableId,
      },
    },
    intents: {
      ...state.intents,
      preferEmbeddedOnConnect: false,
    },
  };
}

function withEvmGrace(
  previous: WalletRegistryState,
  next: WalletRegistryState,
  now: number,
): WalletRegistryState {
  const current = currentActiveEvmConnection(next);
  if (current) {
    return {
      ...next,
      evmGrace: {
        last: {
          address: current.address,
          chainId: current.chainId,
          connectorId: current.uid,
          walletName: current.walletName,
          walletSource:
            current.kind === "embedded-session"
              ? "embedded"
              : current.kind === "walletconnect"
                ? "walletconnect"
                : undefined,
        },
        disconnectedAt: null,
      },
    };
  }

  if (!previous.evmGrace.last) return next;
  return {
    ...next,
    evmGrace: {
      last: previous.evmGrace.last,
      disconnectedAt: previous.evmGrace.disconnectedAt ?? now,
    },
  };
}

function externalHealExpected(
  connections: readonly RegistryConnection[],
): WalletRegistryState["heal"]["expected"] {
  const seen = new Set<string>();
  const expected: WalletRegistryState["heal"]["expected"] = [];
  for (const connection of connections) {
    if (connection.family !== "evm" || connection.kind !== "external-evm") {
      continue;
    }
    const key = `${connection.stableId}:${connection.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    expected.push({
      stableId: connection.stableId,
      address: connection.address.toLowerCase(),
    });
  }
  return expected;
}

function expectedIsLive(
  connections: readonly RegistryConnection[],
  expected: { stableId: string; address: string },
): boolean {
  return connections.some(
    (connection) =>
      connection.family === "evm" &&
      connection.stableId === expected.stableId &&
      connection.address.toLowerCase() === expected.address.toLowerCase(),
  );
}

function expectedConnectorIsLive(
  connections: readonly RegistryConnection[],
  expected: { stableId: string },
): boolean {
  return connections.some(
    (connection) =>
      connection.family === "evm" && connection.stableId === expected.stableId,
  );
}

function nextHealExpectedOnSettled(
  state: WalletRegistryState,
): WalletRegistryState["heal"]["expected"] {
  const missingExpected = state.heal.expected.filter(
    (expected) =>
      !expectedIsLive(state.connections, expected) &&
      !expectedConnectorIsLive(state.connections, expected),
  );
  return missingExpected.length > 0
    ? state.heal.expected
    : externalHealExpected(state.connections);
}

function addDroppedAddress(
  droppedAddresses: readonly string[],
  address: string,
): string[] {
  const normalized = address.toLowerCase();
  return droppedAddresses.includes(normalized)
    ? [...droppedAddresses]
    : [...droppedAddresses, normalized];
}

function dropAddressMatches(
  active: ActiveRef | undefined,
  address: string,
): boolean {
  return !!active && active.address.toLowerCase() === address.toLowerCase();
}

function connectionSignature(
  connections: readonly RegistryConnection[],
): string {
  return JSON.stringify(
    connections
      .map((connection) => ({
        family: connection.family,
        uid: connection.uid,
        stableId: connection.stableId,
        kind: connection.kind,
        address:
          connection.family === "evm"
            ? connection.address.toLowerCase()
            : connection.address,
        addresses: connection.addresses.map((address) =>
          connection.family === "evm" ? address.toLowerCase() : address,
        ),
        chainId: connection.chainId ?? null,
        walletName: connection.walletName ?? null,
      }))
      .sort((left, right) =>
        `${left.family}:${left.uid}:${left.address}`.localeCompare(
          `${right.family}:${right.uid}:${right.address}`,
        ),
      ),
  );
}

export function reduce(
  state: WalletRegistryState,
  event: RegistryEvent,
): WalletRegistryState {
  switch (event.type) {
    case "boot/init": {
      return {
        ...createInitialState(),
        connectionOrder: event.persisted?.order ?? [],
        activeByFamily: activeFromPersisted(event.persisted),
        intents: {
          droppedAddresses:
            event.persisted?.droppedAddresses.map((item) =>
              item.toLowerCase(),
            ) ?? [],
          providerSessionDetached:
            event.persisted?.providerSessionDetached ?? false,
          explicitFamilyDisconnect: {},
          pendingSvmWallet: null,
          preferEmbeddedOnConnect: false,
        },
      };
    }

    case "wagmi/connections-changed": {
      const connections = event.connections.map((connection) =>
        classifyConnection(connection, state.embeddedSession),
      );
      const currentEvmConnections = state.connections.filter(
        (connection) => connection.family === "evm",
      );
      if (
        connectionSignature(connections) ===
        connectionSignature(currentEvmConnections)
      ) {
        return state;
      }
      const nextPhase = state.phase === "stable" ? "settling" : state.phase;
      let next: WalletRegistryState = withConnectionOrder({
        ...state,
        phase: nextPhase,
        connections: [
          ...connections,
          ...withoutSyntheticEmbeddedSessionConnection(
            state,
            state.connections,
          ).filter((connection) => connection.family === "svm"),
        ],
      });
      next = withEmbeddedSessionConnection(next);
      next = withPreferredEmbeddedSessionActive(next);
      if (state.phase === "stable") {
        next = {
          ...next,
          heal: {
            ...next.heal,
            expected: externalHealExpected(state.connections),
          },
        };
      }
      next = withResolvedActive(next, ["evm"]);
      return withEvmGrace(state, next, event.now);
    }

    case "wagmi/config-rebuilt":
      return {
        ...state,
        phase: "rebuilding",
        heal: {
          ...state.heal,
          expected:
            state.phase === "stable"
              ? externalHealExpected(state.connections)
              : state.heal.expected,
        },
      };

    case "wagmi/brands-changed": {
      let changed = false;
      const connections = state.connections.map((connection) => {
        const walletName =
          event.brands[connection.uid] ?? connection.walletName;
        if (walletName !== connection.walletName) changed = true;
        return { ...connection, walletName };
      });
      if (!changed) return state;
      return {
        ...state,
        ...withConnectionOrder({ ...state, connections }),
      };
    }

    case "wagmi/settled": {
      const stateForHeal = { ...state, phase: state.phase };
      const spentBudget =
        state.phase === "stable"
          ? countPlannedHealConnects(stateForHeal, event.now)
          : 0;
      let next: WalletRegistryState = {
        ...state,
        phase: "stable",
        heal: {
          ...state.heal,
          expected: nextHealExpectedOnSettled(state),
          reattachBudget: Math.max(0, state.heal.reattachBudget - spentBudget),
        },
      };
      next = withResolvedActive(next);
      return withEvmGrace(state, next, event.now);
    }

    case "provider/embedded-session-changed": {
      let next: WalletRegistryState = {
        ...state,
        phase: state.phase === "booting" ? "settling" : state.phase,
        embeddedSession: {
          up: event.up,
          providerId: event.providerId,
          uid: event.uid,
          stableId: event.stableId,
          walletName: event.walletName,
          embeddedEvmAddress: event.embeddedEvmAddress?.toLowerCase() ?? null,
          chainId: event.chainId ?? null,
        },
      };
      next = withEmbeddedSessionConnection(next);
      next = withPreferredEmbeddedSessionActive(next);
      next = withResolvedActive(next, ["evm"]);
      return withEvmGrace(state, next, event.now);
    }

    case "provider/auth-flow-started":
      return {
        ...state,
        heal: {
          ...state.heal,
          suppressedUntil: event.now + REATTACH_SUPPRESSION_MS,
          suppressionReason: event.reason,
        },
      };

    case "svm/changed": {
      const uid = event.uid ?? event.walletName ?? event.publicKey;
      const stableId = event.stableId ?? uid;
      const connections = state.connections.filter(
        (connection) =>
          connection.family !== "svm" ||
          (event.stableId
            ? connection.stableId !== event.stableId
            : connection.kind !== "svm"),
      );
      const pendingConnected =
        event.publicKey &&
        state.intents.pendingSvmWallet &&
        event.walletName === state.intents.pendingSvmWallet;
      if (event.publicKey && uid && stableId) {
        connections.push({
          key: `solana:${uid}`,
          family: "svm",
          uid,
          stableId,
          kind: event.kind ?? "svm",
          address: event.publicKey,
          addresses: [event.publicKey],
          walletName: event.walletName ?? undefined,
          providerId: event.providerId,
        });
      }
      let next: WalletRegistryState = withConnectionOrder({
        ...state,
        connections,
        intents: {
          ...state.intents,
          pendingSvmWallet: pendingConnected
            ? null
            : state.intents.pendingSvmWallet,
        },
      });
      if (pendingConnected && event.publicKey) {
        next = {
          ...next,
          activeByFamily: {
            ...next.activeByFamily,
            svm: {
              family: "svm",
              address: event.publicKey,
              uid: uid ?? event.publicKey,
              stableId: stableId ?? event.publicKey,
            },
          },
        };
      }
      return withResolvedActive(next, ["svm"]);
    }

    case "svm/connect-requested":
      return {
        ...state,
        intents: {
          ...state.intents,
          pendingSvmWallet: event.walletName,
        },
      };

    case "svm/connect-settled":
      if (state.intents.pendingSvmWallet !== event.walletName) return state;
      return {
        ...state,
        intents: {
          ...state.intents,
          pendingSvmWallet: null,
        },
      };

    case "user/select-active":
      return {
        ...state,
        activeByFamily: {
          ...state.activeByFamily,
          [event.family]: {
            family: event.family,
            address:
              event.family === "evm"
                ? event.address.toLowerCase()
                : event.address,
            uid: event.uid,
            stableId: event.stableId,
          },
        },
        intents: {
          ...state.intents,
          preferEmbeddedOnConnect: false,
          explicitFamilyDisconnect: {
            ...state.intents.explicitFamilyDisconnect,
            [event.family]: false,
          },
        },
      };

    case "user/connect-succeeded":
      return {
        ...state,
        activeByFamily: {
          ...state.activeByFamily,
          [event.family]: {
            family: event.family,
            address:
              event.family === "evm"
                ? event.address.toLowerCase()
                : event.address,
            uid: event.uid,
            stableId: event.stableId,
          },
        },
        intents: {
          ...state.intents,
          droppedAddresses:
            event.family === "evm"
              ? state.intents.droppedAddresses.filter(
                  (address) => address !== event.address.toLowerCase(),
                )
              : state.intents.droppedAddresses,
          providerSessionDetached:
            event.family === "evm" &&
            event.stableId === state.embeddedSession.stableId
              ? false
              : state.intents.providerSessionDetached,
          explicitFamilyDisconnect: {
            ...state.intents.explicitFamilyDisconnect,
            [event.family]: false,
          },
          preferEmbeddedOnConnect: false,
        },
      };

    case "user/provider-reconnect-requested":
      return withPreferredEmbeddedSessionActive(
        withEmbeddedSessionConnection({
          ...state,
          intents: {
            ...state.intents,
            providerSessionDetached: false,
            preferEmbeddedOnConnect: true,
          },
        }),
      );

    case "user/disconnect-account": {
      const filtered = state.connections.filter(
        (connection) => !event.uids.includes(connection.uid),
      );
      const activeByFamily = { ...state.activeByFamily };
      if (dropAddressMatches(activeByFamily.evm, event.address)) {
        delete activeByFamily.evm;
      }
      let next: WalletRegistryState = withConnectionOrder({
        ...state,
        connections: withoutSyntheticEmbeddedSessionConnection(state, filtered),
        activeByFamily,
        intents: {
          ...state.intents,
          droppedAddresses:
            (event.markDroppedAddress ?? true)
              ? addDroppedAddress(state.intents.droppedAddresses, event.address)
              : [...state.intents.droppedAddresses],
          providerSessionDetached:
            event.isProviderOwnedAccount && event.othersRemain
              ? true
            : state.intents.providerSessionDetached,
        },
      });
      next = withEmbeddedSessionConnection(next);
      next = withResolvedActive(next, ["evm"]);
      return withEvmGrace(state, next, event.now);
    }

    case "user/disconnect-family": {
      const activeByFamily = { ...state.activeByFamily };
      const explicitFamilyDisconnect = {
        ...state.intents.explicitFamilyDisconnect,
      };
      const disconnectsEvm = event.family === "all" || event.family === "evm";
      const disconnectsSvm = event.family === "all" || event.family === "svm";
      if (disconnectsEvm) {
        delete activeByFamily.evm;
        explicitFamilyDisconnect.evm = true;
      }
      if (disconnectsSvm) {
        delete activeByFamily.svm;
        explicitFamilyDisconnect.svm = true;
      }
      let connections = state.connections;
      if (disconnectsEvm) {
        connections = withoutSyntheticEmbeddedSessionConnection(
          state,
          connections,
        );
      }
      if (disconnectsSvm) {
        connections = connections.filter(
          (connection) => connection.family !== "svm",
        );
      }
      let next: WalletRegistryState = withConnectionOrder({
        ...state,
        activeByFamily,
        evmGrace:
          disconnectsEvm
            ? { last: null, disconnectedAt: null }
            : state.evmGrace,
        connections,
        intents: {
          ...state.intents,
          explicitFamilyDisconnect,
          providerSessionDetached:
            disconnectsEvm ? true : state.intents.providerSessionDetached,
        },
      });
      next = withEmbeddedSessionConnection(next);
      return next;
    }

    default:
      return state;
  }
}
