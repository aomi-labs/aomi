import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletRegistryStore, type CommandExecutors } from "./store";
import { AUTH_FLOW_RECONNECT_SETTLE_MS, SETTLE_QUIET_MS } from "./types";

const KEY = "test.aomi.wallet.registry.store";

function executors(): CommandExecutors & {
  calls: Array<[string, string?]>;
} {
  const calls: Array<[string, string?]> = [];
  return {
    calls,
    async wagmiReconnect(stableIds: string[]) {
      calls.push(["wagmi/reconnect", stableIds.join(",")]);
    },
    async wagmiConnect(stableId: string) {
      calls.push(["wagmi/connect", stableId]);
    },
    async wagmiDisconnect(uid: string) {
      calls.push(["wagmi/disconnect", uid]);
    },
    async providerLogout() {
      calls.push(["provider/logout"]);
    },
  };
}

describe("WalletRegistryStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies subscribers and persists active changes", () => {
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.dispatch({
      type: "user/select-active",
      family: "evm",
      address: "0xABC",
      uid: "mm-1",
      stableId: "metaMaskSDK",
      now: 1,
    });

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({
      active: { evm: { address: "0xabc", stableId: "metaMaskSDK" } },
    });
  });

  it("executes planned disconnect commands through injected executors", async () => {
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    store.dispatch({
      type: "user/disconnect-account",
      address: "0xABC",
      uids: ["mm-1"],
      isProviderOwnedAccount: false,
      othersRemain: false,
      now: 1,
    });
    await Promise.resolve();

    expect(fake.calls).toEqual([["wagmi/disconnect", "mm-1"]]);
  });

  it("plans silent reconnect after a config rebuild settles with a missing external", async () => {
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [
        {
          family: "evm",
          uid: "mm-1",
          stableId: "metaMaskSDK",
          address: "0xabc",
          addresses: ["0xabc"],
          chainId: 8453,
          walletName: "MetaMask",
        },
      ],
      now: 1,
    });
    store.dispatch({ type: "wagmi/settled", now: 2 });
    store.dispatch({ type: "wagmi/config-rebuilt", now: 3 });
    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [],
      now: 4,
    });
    store.dispatch({ type: "wagmi/settled", now: 5 });
    await Promise.resolve();

    expect(fake.calls).toContainEqual(["wagmi/reconnect", "metaMaskSDK"]);
  });

  it("does not silently reconnect when a live wallet connector switches accounts", async () => {
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [
        {
          family: "evm",
          uid: "rabby-1",
          stableId: "rabby",
          address: "0xaaa",
          addresses: ["0xaaa"],
          chainId: 8453,
          walletName: "Rabby Wallet",
        },
      ],
      now: 1,
    });
    store.dispatch({ type: "wagmi/settled", now: 2 });
    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [
        {
          family: "evm",
          uid: "rabby-1",
          stableId: "rabby",
          address: "0xbbb",
          addresses: ["0xbbb"],
          chainId: 8453,
          walletName: "Rabby Wallet",
        },
      ],
      now: 3,
    });
    store.dispatch({ type: "wagmi/settled", now: 4 });
    await Promise.resolve();

    expect(fake.calls).not.toContainEqual(["wagmi/reconnect", "rabby"]);
    expect(store.getSnapshot().heal.expected).toEqual([
      { stableId: "rabby", address: "0xbbb" },
    ]);
  });

  it("runs the second-pass popup connect after silent reconnect restores nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [
        {
          family: "evm",
          uid: "mm-1",
          stableId: "metaMaskSDK",
          address: "0xabc",
          addresses: ["0xabc"],
          chainId: 8453,
          walletName: "MetaMask",
        },
      ],
      now: 1,
    });
    store.dispatch({ type: "wagmi/settled", now: 2 });
    store.dispatch({ type: "wagmi/config-rebuilt", now: 3 });
    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [],
      now: 4,
    });
    store.dispatch({ type: "wagmi/settled", now: 5 });
    await Promise.resolve();

    expect(fake.calls).toContainEqual(["wagmi/reconnect", "metaMaskSDK"]);

    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS);

    expect(fake.calls).toContainEqual(["wagmi/connect", "metaMaskSDK"]);
    expect(store.getSnapshot().heal.reattachBudget).toBe(1);
  });

  it("delays the second-pass popup connect while provider auth is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fake = executors();
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [
        {
          family: "evm",
          uid: "rabby-1",
          stableId: "rabby",
          address: "0xabc",
          addresses: ["0xabc"],
          chainId: 8453,
          walletName: "Rabby Wallet",
        },
      ],
      now: 1,
    });
    store.dispatch({ type: "wagmi/settled", now: 2 });
    store.dispatch({
      type: "provider/auth-flow-started",
      reason: "provider-social-login",
      now: 3,
    });
    store.dispatch({ type: "wagmi/config-rebuilt", now: 4 });
    store.dispatch({
      type: "wagmi/connections-changed",
      connections: [],
      now: 5,
    });
    store.dispatch({ type: "wagmi/settled", now: 6 });
    await Promise.resolve();

    expect(fake.calls).toContainEqual(["wagmi/reconnect", "rabby"]);

    await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS);

    expect(fake.calls).not.toContainEqual(["wagmi/connect", "rabby"]);

    await vi.advanceTimersByTimeAsync(
      AUTH_FLOW_RECONNECT_SETTLE_MS - SETTLE_QUIET_MS,
    );

    expect(fake.calls).toContainEqual(["wagmi/connect", "rabby"]);
  });

  it("swallows executor rejections", async () => {
    const fake = executors();
    fake.wagmiDisconnect = async () => {
      throw new Error("boom");
    };
    const store = new WalletRegistryStore({
      executors: fake,
      storageKey: KEY,
      initialNow: 0,
    });

    expect(() =>
      store.dispatch({
        type: "user/disconnect-account",
        address: "0xABC",
        uids: ["mm-1"],
        isProviderOwnedAccount: false,
        othersRemain: false,
        now: 1,
      }),
    ).not.toThrow();
    await Promise.resolve();
  });
});
