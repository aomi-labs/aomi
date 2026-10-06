import type { WalletFamily } from "../types";
import type {
  ActiveRef,
  RegistryCommand,
  RegistryConnection,
  RegistryEvent,
  WalletRegistryState,
} from "./types";

function normalizeAddress(family: WalletFamily, address: string): string {
  return family === "evm" ? address.toLowerCase() : address;
}

function connectionToActive(connection: RegistryConnection): ActiveRef {
  return {
    family: connection.family,
    address: connection.address,
    uid: connection.uid,
    stableId: connection.stableId,
  };
}

function matchesActive(
  connection: RegistryConnection,
  active: ActiveRef,
  requireStableId: boolean,
): boolean {
  if (connection.family !== active.family) return false;
  if (
    normalizeAddress(connection.family, connection.address) !==
    normalizeAddress(active.family, active.address)
  ) {
    return false;
  }
  if (requireStableId && active.stableId) {
    return connection.stableId === active.stableId;
  }
  return true;
}

function findActiveConnection(
  connections: readonly RegistryConnection[],
  active: ActiveRef,
): RegistryConnection | undefined {
  if (active.uid) {
    const byUid = connections.find(
      (connection) =>
        connection.family === active.family && connection.uid === active.uid,
    );
    if (byUid) return byUid;
  }

  if (active.stableId) {
    const byStableId = connections.find((connection) =>
      matchesActive(connection, active, true),
    );
    if (byStableId) return byStableId;
  }

  return connections.find((connection) =>
    matchesActive(connection, active, false),
  );
}

function connectionIsDropped(
  state: WalletRegistryState,
  connection: RegistryConnection,
): boolean {
  return (
    connection.family === "evm" &&
    state.intents.droppedAddresses.includes(connection.address.toLowerCase())
  );
}

export function resolveActive(
  state: WalletRegistryState,
  family: WalletFamily,
): ActiveRef | undefined {
  const familyConnections = state.connections.filter(
    (connection) =>
      connection.family === family && !connectionIsDropped(state, connection),
  );
  const current = state.activeByFamily[family];

  if (current) {
    const live = findActiveConnection(familyConnections, current);
    if (live) return connectionToActive(live);
    if (state.phase !== "stable") return current;
  }

  if (family === "evm") {
    const firstExternal = familyConnections.find(
      (connection) => connection.kind === "external-evm",
    );
    if (state.phase === "stable" && firstExternal) {
      return connectionToActive(firstExternal);
    }

    if (state.phase === "stable") {
      const embeddedSession = familyConnections.find(
        (connection) => connection.kind === "embedded-session",
      );
      return embeddedSession ? connectionToActive(embeddedSession) : undefined;
    }
    return undefined;
  }

  return familyConnections[0]
    ? connectionToActive(familyConnections[0])
    : undefined;
}

function isDropped(state: WalletRegistryState, address: string): boolean {
  return state.intents.droppedAddresses.includes(address.toLowerCase());
}

function expectedIsLive(
  state: WalletRegistryState,
  expected: { stableId: string; address: string },
): boolean {
  return state.connections.some(
    (connection) =>
      connection.family === "evm" &&
      connection.stableId === expected.stableId &&
      connection.address.toLowerCase() === expected.address.toLowerCase(),
  );
}

function expectedConnectorIsLive(
  state: WalletRegistryState,
  expected: { stableId: string },
): boolean {
  return state.connections.some(
    (connection) =>
      connection.family === "evm" && connection.stableId === expected.stableId,
  );
}

function expectedIsHealEligible(
  state: WalletRegistryState,
  expected: { stableId: string; address: string },
  now: number,
): boolean {
  if (state.intents.explicitFamilyDisconnect.evm) return false;
  if (isDropped(state, expected.address)) return false;
  if (
    expected.stableId === state.embeddedSession.stableId ||
    expected.stableId === "walletConnect"
  ) {
    return false;
  }
  if (
    state.heal.suppressedUntil === null ||
    now >= state.heal.suppressedUntil
  ) {
    return true;
  }
  return (
    state.heal.suppressionReason === "provider-social-login" ||
    state.heal.suppressionReason === "provider-auth-modal" ||
    state.heal.suppressionReason === "provider-evm-connect-fallback" ||
    state.heal.suppressionReason === "provider-account-modal"
  );
}

function expectedIsSilentReconnectEligible(
  state: WalletRegistryState,
  expected: { stableId: string; address: string },
): boolean {
  if (state.intents.explicitFamilyDisconnect.evm) return false;
  if (isDropped(state, expected.address)) return false;
  return (
    expected.stableId !== state.embeddedSession.stableId &&
    expected.stableId !== "walletConnect"
  );
}

export function planHeal(
  state: WalletRegistryState,
  now: number,
): RegistryCommand[] {
  const missing = state.heal.expected.filter(
    (expected) =>
      !expectedIsLive(state, expected) &&
      !expectedConnectorIsLive(state, expected),
  );
  if (missing.length === 0) return [];
  const silentReconnectEligible = missing.filter((expected) =>
    expectedIsSilentReconnectEligible(state, expected),
  );
  if (silentReconnectEligible.length === 0) return [];

  if (state.phase !== "stable") {
    return [
      {
        kind: "wagmi/reconnect",
        stableIds: [
          ...new Set(
            silentReconnectEligible.map((expected) => expected.stableId),
          ),
        ],
      },
      {
        kind: "debug",
        event: "evm:heal",
        data: {
          action: "reconnect",
          phase: state.phase,
          missing: silentReconnectEligible.length,
          suppressed: Boolean(
            state.heal.suppressedUntil !== null &&
            now < state.heal.suppressedUntil,
          ),
        },
      },
    ];
  }

  const commands: RegistryCommand[] = [];
  let budget = state.heal.reattachBudget;
  for (const expected of missing) {
    if (budget <= 0) break;
    if (!expectedIsHealEligible(state, expected, now)) continue;
    if (
      !commands.some(
        (command) =>
          command.kind === "wagmi/connect" &&
          command.stableId === expected.stableId,
      )
    ) {
      commands.push({ kind: "wagmi/connect", stableId: expected.stableId });
    }
    budget -= 1;
  }
  if (commands.length > 0) {
    commands.push({
      kind: "debug",
      event: "evm:heal",
      data: { action: "connect", count: commands.length },
    });
  }
  return commands;
}

export function countPlannedHealConnects(
  state: WalletRegistryState,
  now: number,
): number {
  return planHeal(state, now).filter(
    (command) => command.kind === "wagmi/connect",
  ).length;
}

export function planDisconnect(
  state: WalletRegistryState,
  event: Extract<
    RegistryEvent,
    { type: "user/disconnect-account" | "user/disconnect-family" }
  >,
): RegistryCommand[] {
  if (event.type === "user/disconnect-family") {
    const families =
      event.family === "all" ? (["evm", "svm"] as const) : [event.family];
    const commands: RegistryCommand[] = [];
    if (families.includes("evm")) {
      for (const connection of state.connections) {
        if (
          connection.family === "evm" &&
          connection.uid !== state.embeddedSession.uid
        ) {
          commands.push({ kind: "wagmi/disconnect", uid: connection.uid });
        }
      }
    }
    if (families.includes("svm")) {
      commands.push({ kind: "svm/disconnect" });
    }
    if (event.family === "all") commands.push({ kind: "provider/logout" });
    return commands;
  }

  const commands: RegistryCommand[] = event.uids.map((uid) => ({
    kind: "wagmi/disconnect",
    uid,
  }));
  if (event.isProviderOwnedAccount && !event.othersRemain) {
    commands.push({ kind: "provider/logout" });
  }
  return commands;
}
