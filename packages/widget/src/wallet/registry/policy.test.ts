import { describe, expect, it } from "vitest";
import { planDisconnect, planHeal, resolveActive } from "./policy";
import { createInitialState, reduce } from "./reducer";
import type { RegistryConnection, WalletRegistryState } from "./types";

function conn(input: Partial<RegistryConnection> = {}): RegistryConnection {
  return {
    key: "evm:mm-1",
    family: "evm",
    uid: "mm-1",
    stableId: "metaMaskSDK",
    kind: "external-evm",
    address: "0xaaa",
    addresses: ["0xaaa"],
    walletName: "MetaMask",
    chainId: 8453,
    ...input,
  };
}

type StateInput = Omit<Partial<WalletRegistryState>, "heal" | "intents"> & {
  heal?: Partial<WalletRegistryState["heal"]>;
  intents?: Partial<WalletRegistryState["intents"]>;
};

function state(input: StateInput = {}): WalletRegistryState {
  return {
    ...createInitialState(),
    phase: "stable",
    ...input,
    intents: {
      ...createInitialState().intents,
      ...input.intents,
    },
    heal: {
      ...createInitialState().heal,
      ...input.heal,
    },
  };
}

describe("WalletRegistry policy", () => {
  it("keeps a live current active connection and refreshes its uid", () => {
    const active = resolveActive(
      state({
        connections: [
          conn({ uid: "fresh", stableId: "rabby", address: "0xabc" }),
        ],
        activeByFamily: {
          evm: { family: "evm", address: "0xabc", stableId: "rabby" },
        },
      }),
      "evm",
    );

    expect(active).toMatchObject({ uid: "fresh", stableId: "rabby" });
  });

  it("plans silent reconnect on the first settled pass after a rebuild", () => {
    const commands = planHeal(
      state({
        phase: "rebuilding",
        connections: [],
        heal: {
          expected: [{ stableId: "metaMaskSDK", address: "0xaaa" }],
          reattachBudget: 2,
        },
      }),
      100,
    );

    expect(commands[0]).toEqual({
      kind: "wagmi/reconnect",
      stableIds: ["metaMaskSDK"],
    });
  });

  it("plans silent reconnect during suppressed auth-flow settling", () => {
    const commands = planHeal(
      state({
        phase: "settling",
        connections: [],
        heal: {
          expected: [{ stableId: "rabby", address: "0xaaa" }],
          reattachBudget: 2,
          suppressedUntil: 1_000,
        },
      }),
      100,
    );

    expect(commands).toContainEqual({
      kind: "wagmi/reconnect",
      stableIds: ["rabby"],
    });
    expect(commands).toContainEqual({
      kind: "debug",
      event: "evm:heal",
      data: {
        action: "reconnect",
        phase: "settling",
        missing: 1,
        suppressed: true,
      },
    });
  });

  it("does not reconnect a stale address when the same connector is still live", () => {
    const commands = planHeal(
      state({
        phase: "settling",
        connections: [
          conn({ uid: "rb-1", stableId: "rabby", address: "0xbbb" }),
        ],
        heal: {
          expected: [{ stableId: "rabby", address: "0xaaa" }],
          reattachBudget: 2,
        },
      }),
      100,
    );

    expect(commands).toEqual([]);
  });

  it("does not silently heal a deliberate EVM family disconnect", () => {
    const commands = planHeal(
      state({
        phase: "settling",
        connections: [],
        intents: {
          explicitFamilyDisconnect: { evm: true },
        },
        heal: {
          expected: [{ stableId: "rabby", address: "0xaaa" }],
          reattachBudget: 2,
        },
      }),
      100,
    );

    expect(commands).toEqual([]);
  });

  it("plans popup reconnects on the stable second pass and gates by budget", () => {
    const commands = planHeal(
      state({
        connections: [],
        heal: {
          expected: [
            { stableId: "metaMaskSDK", address: "0xaaa" },
            { stableId: "rabby", address: "0xbbb" },
          ],
          reattachBudget: 1,
        },
      }),
      100,
    );

    expect(
      commands.filter((command) => command.kind === "wagmi/connect"),
    ).toEqual([{ kind: "wagmi/connect", stableId: "metaMaskSDK" }]);
  });

  it("does not heal dropped, embedded-provider, WalletConnect, or suppressed connections", () => {
    const commands = planHeal(
      state({
        connections: [],
        embeddedSession: {
          up: true,
          providerId: "para",
          uid: "para-session",
          stableId: "para",
          walletName: "Para",
          embeddedEvmAddress: "0xbbb",
          chainId: null,
        },
        intents: { droppedAddresses: ["0xaaa"] },
        heal: {
          expected: [
            { stableId: "metaMaskSDK", address: "0xaaa" },
            { stableId: "para", address: "0xbbb" },
            { stableId: "walletConnect", address: "0xccc" },
            { stableId: "rabby", address: "0xddd" },
          ],
          reattachBudget: 2,
          suppressedUntil: 200,
        },
      }),
      100,
    );

    expect(commands.some((command) => command.kind === "wagmi/connect")).toBe(
      false,
    );
  });

  it("allows second-pass popup reconnect during provider auth suppression", () => {
    const commands = planHeal(
      state({
        connections: [],
        heal: {
          expected: [{ stableId: "rabby", address: "0xaaa" }],
          reattachBudget: 1,
          suppressedUntil: 1_000,
          suppressionReason: "provider-social-login",
        },
      }),
      100,
    );

    expect(commands).toContainEqual({
      kind: "wagmi/connect",
      stableId: "rabby",
    });
  });

  it("allows heal when suppression expires exactly at now", () => {
    const commands = planHeal(
      state({
        connections: [],
        heal: {
          expected: [{ stableId: "metaMaskSDK", address: "0xaaa" }],
          reattachBudget: 1,
          suppressedUntil: 200,
        },
      }),
      200,
    );

    expect(commands).toContainEqual({
      kind: "wagmi/connect",
      stableId: "metaMaskSDK",
    });
  });

  it("emits disconnect commands and logs the embedded provider out for all-family disconnect", () => {
    const current = state({
      embeddedSession: {
        up: true,
        providerId: "para",
        uid: "para-session",
        stableId: "para",
        walletName: "Para",
        embeddedEvmAddress: "0xaaa",
        chainId: null,
      },
      connections: [
        conn({
          uid: "para-1",
          stableId: "para",
          kind: "embedded-session",
        }),
        conn({
          uid: "para-session",
          stableId: "para",
          kind: "embedded-session",
        }),
        conn({ uid: "mm-1", stableId: "metaMaskSDK" }),
      ],
    });
    const commands = planDisconnect(current, {
      type: "user/disconnect-family",
      family: "all",
      now: 100,
    });

    expect(commands).toEqual([
      { kind: "wagmi/disconnect", uid: "para-1" },
      { kind: "wagmi/disconnect", uid: "mm-1" },
      { kind: "svm/disconnect" },
      { kind: "provider/logout" },
    ]);
  });

  it("does not resolve a dropped external wallet as active fallback", () => {
    const active = resolveActive(
      state({
        connections: [conn({ address: "0xaaa" })],
        intents: { droppedAddresses: ["0xaaa"] },
      }),
      "evm",
    );

    expect(active).toBeUndefined();
  });

  it("decrements reattach budget through the settled reducer path", () => {
    let current = state({
      heal: {
        expected: [{ stableId: "metaMaskSDK", address: "0xaaa" }],
        reattachBudget: 2,
      },
    });
    current = reduce(current, { type: "wagmi/settled", now: 100 });

    expect(current.heal.reattachBudget).toBe(1);
  });
});
