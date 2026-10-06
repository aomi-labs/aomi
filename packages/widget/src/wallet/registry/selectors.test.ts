import { describe, expect, it } from "vitest";
import { createInitialState } from "./reducer";
import { selectAccounts, selectEvmIdentity } from "./selectors";
import type { RegistryConnection, WalletRegistryState } from "./types";

function evm(input: Partial<RegistryConnection> = {}): RegistryConnection {
  return {
    key: "evm:mm-1",
    family: "evm",
    uid: "mm-1",
    stableId: "metaMaskSDK",
    kind: "external-evm",
    address: "0xaaa",
    addresses: ["0xaaa"],
    chainId: 8453,
    walletName: "MetaMask",
    ...input,
  };
}

type StateInput = Omit<Partial<WalletRegistryState>, "evmGrace" | "intents"> & {
  evmGrace?: Partial<WalletRegistryState["evmGrace"]>;
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
    evmGrace: {
      ...createInitialState().evmGrace,
      ...input.evmGrace,
    },
  };
}

describe("WalletRegistry selectors", () => {
  it("keeps the selected EVM chain in a disconnected identity", () => {
    expect(selectEvmIdentity(state(), 100, 5042002)).toEqual({
      chainId: 5042002,
    });
  });

  it("selects the active EVM identity from the live registry connection", () => {
    const current = state({
      connections: [evm()],
      activeByFamily: {
        evm: {
          family: "evm",
          address: "0xaaa",
          uid: "mm-1",
          stableId: "metaMaskSDK",
        },
      },
    });

    expect(selectEvmIdentity(current, 100)).toEqual({
      address: "0xaaa",
      chainId: 8453,
      connectorId: "mm-1",
      walletName: "MetaMask",
    });
  });

  it("uses the selected EVM chain for active embedded sessions without a native chain", () => {
    const current = state({
      connections: [
        evm({
          key: "evm:para-session",
          uid: "para-session",
          stableId: "para",
          kind: "embedded-session",
          walletName: "Para",
          chainId: undefined,
        }),
      ],
      activeByFamily: {
        evm: {
          family: "evm",
          address: "0xaaa",
          uid: "para-session",
          stableId: "para",
        },
      },
    });

    expect(selectEvmIdentity(current, 100, 8453)).toEqual({
      address: "0xaaa",
      chainId: 8453,
      connectorId: "para-session",
      walletName: "Para",
      walletSource: "embedded",
    });
    expect(selectAccounts(current, "evm", 100, 8453)[0]).toMatchObject({
      id: "para-session",
      family: "evm",
      chainId: 8453,
      walletName: "Para",
    });
  });

  it("uses grace identity during a short handoff and preserves selected chain", () => {
    const current = state({
      evmGrace: {
        last: {
          address: "0xaaa",
          chainId: 42161,
          connectorId: "rabby-1",
          walletName: "Rabby",
        },
        disconnectedAt: 100,
      },
    });

    expect(selectEvmIdentity(current, 200, 8453)).toEqual({
      address: "0xaaa",
      chainId: 8453,
      connectorId: "rabby-1",
      walletName: "Rabby",
    });
  });

  it("does not restart an expired grace identity", () => {
    const current = state({
      evmGrace: {
        last: { address: "0xaaa", chainId: 42161 },
        disconnectedAt: 100,
      },
    });

    expect(selectEvmIdentity(current, 2_000)).toEqual({});
    expect(selectEvmIdentity(current, 3_000)).toEqual({});
  });

  it("excludes a user-dropped address from grace", () => {
    const current = state({
      intents: { droppedAddresses: ["0xaaa"] },
      evmGrace: {
        last: { address: "0xaaa", chainId: 42161 },
        disconnectedAt: 100,
      },
    });

    expect(selectEvmIdentity(current, 200)).toEqual({});
  });

  it("maps registry connections to account rows with runtime uid ids", () => {
    const current = state({
      connections: [
        evm({ uid: "rb", walletName: "Rabby", address: "0xaaa" }),
        evm({ uid: "mm", walletName: "MetaMask", address: "0xAAA" }),
        {
          key: "solana:Phantom",
          family: "svm",
          uid: "Phantom",
          stableId: "Phantom",
          kind: "svm",
          address: "9xQpub",
          addresses: ["9xQpub"],
          walletName: "Phantom",
        },
      ],
      activeByFamily: {
        evm: {
          family: "evm",
          address: "0xaaa",
          uid: "mm",
          stableId: "metaMaskSDK",
        },
        svm: {
          family: "svm",
          address: "9xQpub",
          uid: "Phantom",
          stableId: "Phantom",
        },
      },
    });

    const accounts = [
      ...selectAccounts(current, "evm", 100),
      ...selectAccounts(current, "svm", 100),
    ];

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      family: "evm",
      id: "mm",
      walletName: "MetaMask",
      active: true,
    });
    expect(accounts[0].connectorIds).toEqual(["rb", "mm"]);
    expect(accounts[1]).toMatchObject({
      family: "svm",
      id: "Phantom",
      address: "9xQpub",
      active: true,
    });
  });

  it("maps multiple Solana registry connections to account rows", () => {
    const current = state({
      connections: [
        {
          key: "solana:para-solana-session",
          family: "svm",
          uid: "para-solana-session",
          stableId: "para",
          kind: "embedded-session",
          address: "ParaPubkey",
          addresses: ["ParaPubkey"],
          walletName: "Para Solana",
        },
        {
          key: "solana:Phantom",
          family: "svm",
          uid: "Phantom",
          stableId: "Phantom",
          kind: "svm",
          address: "PhantomPubkey",
          addresses: ["PhantomPubkey"],
          walletName: "Phantom",
        },
      ],
      activeByFamily: {
        svm: {
          family: "svm",
          address: "ParaPubkey",
          uid: "para-solana-session",
          stableId: "para",
        },
      },
    });

    const accounts = selectAccounts(current, "svm", 100);

    expect(accounts).toEqual([
      expect.objectContaining({
        family: "svm",
        id: "para-solana-session",
        address: "ParaPubkey",
        walletName: "Para Solana",
        active: true,
      }),
      expect.objectContaining({
        family: "svm",
        id: "Phantom",
        address: "PhantomPubkey",
        walletName: "Phantom",
        active: false,
      }),
    ]);
  });
});
