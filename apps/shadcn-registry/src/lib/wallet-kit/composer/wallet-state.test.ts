import { describe, expect, it } from "vitest";
import { resolveWalletState, type WalletStateInput } from "./wallet-state";

const METAMASK = "0xAAaa000000000000000000000000000000000001";
const RABBY = "0xBBbb000000000000000000000000000000000002";

const external = (id: string, address: string) =>
  ({ id, family: "evm", address, kind: "external" }) as const;

const linkedEvm = (id: string, address: string) =>
  ({ id, family: "evm", address }) as const;
const key = (address: string) => `evm:${address.toLowerCase()}`;
const actionKinds = (actions: readonly { kind: string }[]) =>
  actions.map((action) => action.kind);

const PRIVY_LINKED = "0xb3ec00000000000000000000000000000000ebd0";
const PRIVY_CLIENT = "0xdc27000000000000000000000000000000000e12";

function input(overrides: Partial<WalletStateInput>): WalletStateInput {
  return {
    account: { id: "acct-1", status: "ready" },
    linked: [],
    connections: [],
    mountedProviders: [],
    selection: {},
    ...overrides,
  };
}

describe("operating wallet", () => {
  it("operates the sole wallet that is both linked and connected", () => {
    const state = resolveWalletState(
      input({
        linked: [{ id: "w1", family: "evm", address: METAMASK }],
        connections: [
          {
            id: "c1",
            family: "evm",
            address: METAMASK.toLowerCase(),
            kind: "external",
          },
        ],
      }),
    );

    expect(state.operating.evm).toBe(`evm:${METAMASK.toLowerCase()}`);
    expect(state.wallets).toEqual([
      expect.objectContaining({
        state: "ready",
        operating: true,
        linkedWalletId: "w1",
        connectionId: "c1",
        actions: [
          { kind: "disconnect", connectionId: "c1" },
          { kind: "unlink", linkedWalletId: "w1" },
        ],
      }),
    ]);
  });

  it("never operates a connected wallet the account has not linked", () => {
    const state = resolveWalletState(
      input({ connections: [external("c1", RABBY)] }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.wallets).toEqual([
      expect.objectContaining({
        state: "unlinked",
        operating: false,
      }),
    ]);
    expect(actionKinds(state.wallets[0].actions)).toEqual([
      "link",
      "disconnect",
    ]);
    expect(state.wallets[0].actions).toContainEqual({
      kind: "link",
      connectionId: "c1",
    });
  });

  it("operates nothing until the user chooses between several eligible wallets", () => {
    const state = resolveWalletState(
      input({
        linked: [linkedEvm("w1", METAMASK), linkedEvm("w2", RABBY)],
        connections: [external("c1", METAMASK), external("c2", RABBY)],
      }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.wallets.map((wallet) => actionKinds(wallet.actions))).toEqual([
      ["select", "disconnect", "unlink"],
      ["select", "disconnect", "unlink"],
    ]);
  });

  it("restores the stored selection, so connecting another wallet never takes over", () => {
    const state = resolveWalletState(
      input({
        linked: [linkedEvm("w1", METAMASK), linkedEvm("w2", RABBY)],
        connections: [external("c2", RABBY), external("c1", METAMASK)],
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.operating.evm).toBe(key(METAMASK));
  });

  it("keeps a temporarily unavailable selection instead of switching to another wallet", () => {
    const state = resolveWalletState(
      input({
        linked: [linkedEvm("w1", METAMASK), linkedEvm("w2", RABBY)],
        connections: [external("c2", RABBY)],
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.clearSelection).toEqual([]);
    expect(state.wallets).toContainEqual(
      expect.objectContaining({
        key: key(METAMASK),
        state: "offline",
        reason: "disconnected",
      }),
    );
    expect(
      actionKinds(
        state.wallets.find((wallet) => wallet.key === key(METAMASK))!.actions,
      ),
    ).toEqual(["connect", "unlink"]);
  });

  it("clears a selection whose wallet was unlinked, then treats it as absent", () => {
    const state = resolveWalletState(
      input({
        linked: [linkedEvm("w2", RABBY)],
        connections: [external("c1", METAMASK), external("c2", RABBY)],
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.clearSelection).toEqual(["evm"]);
    expect(state.operating.evm).toBe(key(RABBY));
  });

  it("decides nothing while the account's wallets are still loading", () => {
    const state = resolveWalletState(
      input({
        account: { id: "acct-1", status: "loading" },
        connections: [external("c1", METAMASK)],
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.clearSelection).toEqual([]);
    expect(state.wallets).toEqual([
      expect.objectContaining({ state: "loading" }),
    ]);
    expect(actionKinds(state.wallets[0].actions)).toEqual(["disconnect"]);
  });

  it("does not operate stale linked data while the account reloads", () => {
    const state = resolveWalletState(
      input({
        account: { id: "acct-1", status: "loading" },
        linked: [linkedEvm("w1", METAMASK)],
        connections: [external("c1", METAMASK)],
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.operating).toEqual({});
    expect(state.wallets).toEqual([
      expect.objectContaining({ state: "loading", operating: false }),
    ]);
  });

  it("keeps the selection through an account reload with nothing connected", () => {
    const state = resolveWalletState(
      input({
        account: { id: "acct-1", status: "loading" },
        selection: { evm: key(METAMASK) },
      }),
    );

    expect(state.clearSelection).toEqual([]);
  });

  it("lets a guest operate a connected external wallet they chose", () => {
    const state = resolveWalletState(
      input({
        account: null,
        connections: [external("c1", METAMASK), external("c2", RABBY)],
        selection: { evm: key(RABBY) },
      }),
    );

    expect(state.operating.evm).toBe(key(RABBY));
    expect(state.clearSelection).toEqual([]);
    expect(state.wallets.map((wallet) => wallet.state)).toEqual([
      "guest",
      "guest",
    ]);
    expect(state.wallets.map((wallet) => actionKinds(wallet.actions))).toEqual([
      ["select", "link", "disconnect"],
      ["link", "disconnect"],
    ]);
  });
});

const privyLinked = {
  id: "w1",
  family: "evm",
  address: PRIVY_LINKED,
  kind: "embedded",
  provider: "privy",
} as const;
const privySession = (address: string, signerReady: boolean) =>
  ({
    id: "privy-session",
    family: "evm",
    address,
    kind: "embedded",
    provider: "privy",
    signerReady,
  }) as const;

describe("embedded wallets", () => {
  it("does not publish one before account exchange completes", () => {
    const state = resolveWalletState(
      input({
        account: null,
        connections: [privySession(PRIVY_CLIENT, true)],
        mountedProviders: ["privy"],
      }),
    );

    expect(state.operating).toEqual({});
    expect(state.wallets).toEqual([
      expect.objectContaining({ state: "loading", operating: false }),
    ]);
  });

  it("flags a client address the account never attested, and never operates it", () => {
    const state = resolveWalletState(
      input({
        linked: [
          {
            id: "w1",
            family: "evm",
            address: PRIVY_LINKED,
            kind: "embedded",
            provider: "privy",
          },
        ],
        connections: [
          {
            id: "privy-session",
            family: "evm",
            address: PRIVY_CLIENT,
            kind: "embedded",
            provider: "privy",
            signerReady: true,
          },
        ],
        mountedProviders: ["privy"],
      }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.wallets).toEqual([
      expect.objectContaining({
        key: key(PRIVY_LINKED),
        state: "mismatch",
      }),
    ]);
    expect(actionKinds(state.wallets[0].actions)).toEqual(["reauthenticate"]);
  });

  it("is loading, not mismatched, while the provider has no signer yet", () => {
    const state = resolveWalletState(
      input({
        linked: [privyLinked],
        connections: [privySession(PRIVY_LINKED, false)],
        mountedProviders: ["privy"],
      }),
    );

    expect(state.operating.evm).toBeUndefined();
    expect(state.wallets).toEqual([
      expect.objectContaining({ state: "loading", operating: false }),
    ]);
  });

  it("waits for the provider before judging a different embedded address", () => {
    const state = resolveWalletState(
      input({
        linked: [privyLinked],
        connections: [privySession(PRIVY_CLIENT, false)],
        mountedProviders: ["privy"],
      }),
    );

    expect(state.operating).toEqual({});
    expect(state.wallets).toEqual([
      expect.objectContaining({ state: "loading", operating: false }),
    ]);
  });

  it("cannot be connected on a host that does not mount its provider", () => {
    const state = resolveWalletState(
      input({ linked: [privyLinked], mountedProviders: ["para"] }),
    );

    expect(state.wallets).toEqual([
      expect.objectContaining({
        state: "offline",
        reason: "provider_unavailable",
      }),
    ]);
    expect(actionKinds(state.wallets[0].actions)).toEqual(["unlink"]);
  });
});
