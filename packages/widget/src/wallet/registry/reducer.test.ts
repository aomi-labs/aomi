import { describe, expect, it } from "vitest";
import { createInitialState, reduce } from "./reducer";
import { selectEvmIdentity } from "./selectors";
import type { RegistryConnection, WalletRegistryState } from "./types";

function boot(): WalletRegistryState {
  return reduce(createInitialState(), {
    type: "boot/init",
    persisted: null,
    now: 0,
  });
}

function evm(
  uid: string,
  stableId: string,
  address: string,
  walletName = stableId,
): Omit<RegistryConnection, "key" | "kind"> {
  return {
    family: "evm",
    uid,
    stableId,
    address,
    addresses: [address],
    walletName,
    chainId: 8453,
  };
}

function embeddedSession(address: string, now: number, chainId?: number) {
  return {
    type: "provider/embedded-session-changed" as const,
    up: true,
    providerId: "para",
    uid: "para-session",
    stableId: "para",
    walletName: "Para",
    embeddedEvmAddress: address,
    chainId,
    now,
  };
}

describe("WalletRegistry reducer", () => {
  it("keeps a persisted active wish through boot ordering and resolves it by stable id", () => {
    let state = reduce(createInitialState(), {
      type: "boot/init",
      persisted: {
        version: 1,
        active: { evm: { address: "0xbbb", stableId: "rabby" } },
        droppedAddresses: [],
        providerSessionDetached: false,
      },
      now: 0,
    });

    state = reduce(state, {
      ...embeddedSession("0xAAA", 5),
    });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("para-1", "para", "0xaaa", "Para")],
      now: 10,
    });
    expect(state.activeByFamily.evm?.address).toBe("0xbbb");
    expect(state.activeByFamily.evm?.uid).toBeUndefined();

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [
        evm("para-1", "para", "0xaaa", "Para"),
        evm("rabby-new-uid", "rabby", "0xbbb", "Rabby"),
      ],
      now: 20,
    });
    state = reduce(state, { type: "wagmi/settled", now: 30 });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      uid: "rabby-new-uid",
      stableId: "rabby",
    });
  });

  it("chooses the first external wallet at stable when there is no persisted wish", () => {
    let state = boot();
    state = reduce(state, {
      ...embeddedSession("0xAAA", 5),
    });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [
        evm("para-1", "para", "0xaaa", "Para"),
        evm("mm-1", "metaMaskSDK", "0xbbb", "MetaMask"),
      ],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      stableId: "metaMaskSDK",
    });
  });

  it("falls back to Para when it is the only EVM connection", () => {
    let state = boot();
    state = reduce(state, {
      ...embeddedSession("0xAAA", 5),
    });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("para-1", "para", "0xaaa", "Para")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xaaa",
      stableId: "para",
    });
  });

  it("creates an active Para connection from the Para session when wagmi has none", () => {
    let state = boot();
    state = reduce(state, {
      ...embeddedSession("0xAAA", 10, 8453),
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    expect(state.connections).toContainEqual(
      expect.objectContaining({
        family: "evm",
        uid: "para-session",
        stableId: "para",
        address: "0xaaa",
        chainId: 8453,
        walletName: "Para",
      }),
    );
    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xaaa",
      stableId: "para",
    });
  });

  it("keeps external active while representing a connected Para session", () => {
    let state = boot();
    state = reduce(state, {
      ...embeddedSession("0xAAA", 10),
    });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xBBB", "Rabby")],
      now: 20,
    });
    state = reduce(state, { type: "wagmi/settled", now: 30 });

    expect(state.connections.map((connection) => connection.stableId)).toEqual(
      expect.arrayContaining(["para", "rabby"]),
    );
    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      stableId: "rabby",
    });
  });

  it("preserves persisted wallet order across reloads", () => {
    let state = reduce(createInitialState(), {
      type: "boot/init",
      persisted: {
        version: 1,
        active: {},
        droppedAddresses: [],
        providerSessionDetached: false,
        order: [
          { family: "evm", stableId: "rabby", address: "0xbbb" },
          { family: "evm", stableId: "metaMaskSDK", address: "0xaaa" },
        ],
      },
      now: 0,
    });

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [
        evm("mm", "metaMaskSDK", "0xAAA", "MetaMask"),
        evm("rb", "rabby", "0xBBB", "Rabby"),
      ],
      now: 10,
    });

    expect(
      state.connections.map((connection) => connection.walletName),
    ).toEqual(["Rabby", "MetaMask"]);
  });

  it("does not reorder connected wallets when selecting a different active wallet", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [
        evm("mm", "metaMaskSDK", "0xAAA", "MetaMask"),
        evm("rb", "rabby", "0xBBB", "Rabby"),
      ],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    state = reduce(state, {
      type: "user/select-active",
      family: "evm",
      address: "0xBBB",
      uid: "rb",
      stableId: "rabby",
      now: 30,
    });

    expect(
      state.connections.map((connection) => connection.walletName),
    ).toEqual(["MetaMask", "Rabby"]);
    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      stableId: "rabby",
    });
  });

  it("makes a newly connected EVM wallet active without moving its row", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("mm", "metaMaskSDK", "0xAAA", "MetaMask")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [
        evm("mm", "metaMaskSDK", "0xAAA", "MetaMask"),
        evm("rb", "rabby", "0xBBB", "Rabby"),
      ],
      now: 30,
    });
    state = reduce(state, {
      type: "user/connect-succeeded",
      family: "evm",
      address: "0xBBB",
      uid: "rb",
      stableId: "rabby",
      now: 31,
    });
    state = reduce(state, { type: "wagmi/settled", now: 40 });

    expect(
      state.connections.map((connection) => connection.walletName),
    ).toEqual(["MetaMask", "Rabby"]);
    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      stableId: "rabby",
    });
  });

  it("treats an in-wallet EVM account switch as the current live connection", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xAAA", "Rabby")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xBBB", "Rabby")],
      now: 30,
    });
    state = reduce(state, { type: "wagmi/settled", now: 40 });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      uid: "rb",
      stableId: "rabby",
    });
    expect(state.heal.expected).toEqual([
      { stableId: "rabby", address: "0xbbb" },
    ]);
  });

  it("refreshes heal expectations when an account switch overlaps a rebuild", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xAAA", "Rabby")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });
    state = reduce(state, { type: "wagmi/config-rebuilt", now: 30 });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb-new", "rabby", "0xBBB", "Rabby")],
      now: 40,
    });
    state = reduce(state, { type: "wagmi/settled", now: 50 });

    expect(state.heal.expected).toEqual([
      { stableId: "rabby", address: "0xbbb" },
    ]);
  });

  it("makes Para active after an explicit Para connect when the old active wallet is absent", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xBBB", "Rabby")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });
    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xbbb",
      stableId: "rabby",
    });

    state = reduce(state, {
      type: "user/provider-reconnect-requested",
      now: 30,
    });
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [],
      now: 40,
    });
    state = reduce(state, {
      ...embeddedSession("0xAAA", 50),
    });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xaaa",
      uid: "para-session",
      stableId: "para",
    });
  });

  it("makes Para active after an explicit Para connect even if an external wallet is live", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("rb", "rabby", "0xBBB", "Rabby")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });
    state = reduce(state, {
      type: "user/provider-reconnect-requested",
      now: 30,
    });
    state = reduce(state, {
      ...embeddedSession("0xAAA", 40),
    });

    expect(state.activeByFamily.evm).toMatchObject({
      address: "0xaaa",
      uid: "para-session",
      stableId: "para",
    });
    expect(state.intents.preferEmbeddedOnConnect).toBe(false);
  });

  it("does not recreate the synthetic Para connection while locally detached", () => {
    let state = boot();
    state = {
      ...state,
      intents: {
        ...state.intents,
        providerSessionDetached: true,
      },
    };
    state = reduce(state, {
      ...embeddedSession("0xAAA", 10),
    });

    expect(state.connections).toEqual([]);
    expect(state.activeByFamily.evm).toBeUndefined();
  });

  it("stamps EVM grace once when the active connection vanishes and clears when it returns", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("mm-1", "metaMaskSDK", "0xbbb", "MetaMask")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [],
      now: 100,
    });
    expect(state.evmGrace.disconnectedAt).toBe(100);
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [],
      now: 200,
    });
    expect(state.evmGrace.disconnectedAt).toBe(100);

    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("mm-2", "metaMaskSDK", "0xbbb", "MetaMask")],
      now: 300,
    });
    state = reduce(state, { type: "wagmi/settled", now: 310 });
    expect(state.evmGrace.disconnectedAt).toBeNull();
  });

  it("clears only the deliberately connected dropped address", () => {
    let state = boot();
    state = reduce(state, {
      type: "user/disconnect-account",
      address: "0xBBB",
      uids: ["mm-1"],
      isProviderOwnedAccount: false,
      othersRemain: false,
      now: 10,
    });
    state = {
      ...state,
      intents: {
        ...state.intents,
        droppedAddresses: [...state.intents.droppedAddresses, "0xpara"],
      },
    };

    state = reduce(state, {
      type: "user/connect-succeeded",
      family: "evm",
      address: "0xBBB",
      uid: "mm-2",
      stableId: "metaMaskSDK",
      now: 20,
    });
    expect(state.intents.droppedAddresses).toEqual(["0xpara"]);
  });

  it("clears local Para detach only for an explicit Para reconnect request", () => {
    let state = boot();
    state = {
      ...state,
      intents: {
        ...state.intents,
        providerSessionDetached: true,
        droppedAddresses: ["0xpara"],
      },
    };

    state = reduce(state, {
      type: "user/provider-reconnect-requested",
      now: 20,
    });

    expect(state.intents.providerSessionDetached).toBe(false);
    expect(state.intents.droppedAddresses).toEqual(["0xpara"]);
  });

  it("does not mark a dropped address when a same-address wallet remains", () => {
    let state = boot();
    state = reduce(state, {
      type: "user/disconnect-account",
      address: "0xAAA",
      uids: ["para-1"],
      isProviderOwnedAccount: true,
      othersRemain: true,
      markDroppedAddress: false,
      now: 10,
    });

    expect(state.intents.providerSessionDetached).toBe(true);
    expect(state.intents.droppedAddresses).toEqual([]);
  });

  it("excludes an explicitly dropped address from grace identity", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("mm-1", "metaMaskSDK", "0xBBB", "MetaMask")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });
    state = reduce(state, {
      type: "user/disconnect-account",
      address: "0xBBB",
      uids: ["mm-1"],
      isProviderOwnedAccount: false,
      othersRemain: false,
      now: 30,
    });

    expect(selectEvmIdentity(state, 31, 8453).address).toBeUndefined();
  });

  it("clears grace identity immediately on EVM family disconnect", () => {
    let state = boot();
    state = reduce(state, {
      type: "wagmi/connections-changed",
      connections: [evm("mm-1", "metaMaskSDK", "0xBBB", "MetaMask")],
      now: 10,
    });
    state = reduce(state, { type: "wagmi/settled", now: 20 });

    state = reduce(state, {
      type: "user/disconnect-family",
      family: "evm",
      now: 30,
    });

    expect(state.evmGrace.last).toBeNull();
    expect(selectEvmIdentity(state, 31, 8453).address).toBeUndefined();
  });

  it("tracks and clears a pending SVM connect request", () => {
    let state = boot();
    state = reduce(state, {
      type: "svm/connect-requested",
      walletName: "Phantom",
      now: 10,
    });
    expect(state.intents.pendingSvmWallet).toBe("Phantom");

    state = reduce(state, {
      type: "svm/changed",
      publicKey: "sol-pubkey",
      walletName: "Phantom",
      now: 20,
    });

    expect(state.intents.pendingSvmWallet).toBeNull();
    expect(state.activeByFamily.svm).toMatchObject({
      address: "sol-pubkey",
      stableId: "Phantom",
    });
  });

  it("preserves Para embedded Solana when external Solana adapter changes", () => {
    let state = boot();
    state = reduce(state, {
      type: "svm/changed",
      publicKey: "para-sol",
      uid: "para-solana-session",
      stableId: "para",
      kind: "embedded-session",
      walletName: "Para Solana",
      now: 10,
    });
    state = reduce(state, {
      type: "svm/changed",
      publicKey: null,
      walletName: null,
      now: 20,
    });

    expect(state.connections).toContainEqual(
      expect.objectContaining({
        family: "svm",
        stableId: "para",
        kind: "embedded-session",
        address: "para-sol",
      }),
    );

    state = reduce(state, {
      type: "svm/changed",
      publicKey: "phantom-sol",
      walletName: "Phantom",
      now: 30,
    });

    expect(state.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableId: "para", address: "para-sol" }),
        expect.objectContaining({
          stableId: "Phantom",
          address: "phantom-sol",
        }),
      ]),
    );

    state = reduce(state, {
      type: "svm/changed",
      publicKey: null,
      uid: "para-solana-session",
      stableId: "para",
      kind: "embedded-session",
      walletName: "Para Solana",
      now: 40,
    });

    expect(state.connections).toContainEqual(
      expect.objectContaining({ stableId: "Phantom", address: "phantom-sol" }),
    );
    expect(
      state.connections.some(
        (connection) =>
          connection.family === "svm" && connection.stableId === "para",
      ),
    ).toBe(false);
  });

  it("locally clears embedded SVM sessions on all-family disconnect", () => {
    let state = boot();
    state = reduce(state, {
      type: "svm/changed",
      publicKey: "privy-sol",
      uid: "privy-solana-session",
      stableId: "privy",
      kind: "embedded-session",
      providerId: "privy",
      walletName: "Privy Solana",
      now: 10,
    });
    expect(state.connections).toContainEqual(
      expect.objectContaining({
        family: "svm",
        stableId: "privy",
        address: "privy-sol",
      }),
    );

    state = reduce(state, {
      type: "user/disconnect-family",
      family: "all",
      now: 20,
    });

    expect(
      state.connections.some((connection) => connection.family === "svm"),
    ).toBe(false);
    expect(state.activeByFamily.svm).toBeUndefined();
  });

  it("ignores stale SVM connect-settled events for a newer request", () => {
    let state = boot();
    state = reduce(state, {
      type: "svm/connect-requested",
      walletName: "Phantom",
      now: 10,
    });
    state = reduce(state, {
      type: "svm/connect-requested",
      walletName: "Solflare",
      now: 11,
    });
    state = reduce(state, {
      type: "svm/connect-settled",
      walletName: "Phantom",
      now: 20,
    });

    expect(state.intents.pendingSvmWallet).toBe("Solflare");
  });
});
