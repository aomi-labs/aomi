import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeSvmWalletConnect,
  getSvmCapabilitySnapshot,
  standardV1Signer,
  useMergedSvmWallet,
  useSafeSvmWallet,
  type SafeSvmWalletState,
} from "./wallet-runtime";

function walletState(
  overrides: Partial<SafeSvmWalletState> = {},
): SafeSvmWalletState {
  return {
    publicKey: undefined,
    connected: false,
    connecting: false,
    disconnecting: false,
    walletName: undefined,
    wallets: [],
    select: vi.fn(),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    signTransaction: undefined,
    signAllTransactions: undefined,
    signMessage: undefined,
    sendTransaction: undefined,
    ...overrides,
  };
}

describe("useSafeSvmWallet outside a WalletProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the disconnected state without logging missing-provider errors", () => {
    // The adapter library's default context "throws" by console.error-ing from
    // property getters instead of raising, so a try/catch alone cannot contain
    // it. This pins the descriptor-probe boundary: no reads, no log spam.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useSafeSvmWallet());

    expect(result.current.connected).toBe(false);
    expect(result.current.publicKey).toBeUndefined();
    expect(result.current.wallets).toEqual([]);
    expect(result.current.select).toBeUndefined();
    const missingProviderLogs = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes("WalletContext without providing one"),
    );
    expect(missingProviderLogs).toEqual([]);
  });
});

describe("generic Solana wallet composition", () => {
  it("keeps standard wallet-adapter options beside provider wallets", () => {
    const selectExternal = vi.fn();
    const external = walletState({
      wallets: [
        {
          adapter: { name: "Phantom", readyState: "Installed" },
          readyState: "Installed",
        },
      ],
      select: selectExternal,
    });
    const embedded = walletState({
      publicKey: "privy-solana-address",
      connected: true,
      walletName: "Privy Solana",
      providerId: "privy",
      transport: "embedded",
      wallets: [
        {
          adapter: { name: "Privy Solana", readyState: "Installed" },
          readyState: "Installed",
        },
      ],
    });

    const { result } = renderHook(() => useMergedSvmWallet(external, embedded));

    expect(result.current.publicKey).toBe("privy-solana-address");
    expect(result.current.wallets.map((entry) => entry.adapter.name)).toEqual([
      "Phantom",
      "Privy Solana",
    ]);

    act(() => result.current.select?.("Phantom" as never));

    expect(selectExternal).toHaveBeenCalledWith("Phantom");
    expect(result.current.publicKey).toBeUndefined();
  });

  it("does not race WalletProvider autoConnect with a second connect", async () => {
    const connect = vi.fn(async () => undefined);
    let current = walletState({
      connect,
      select: vi.fn(() => {
        current = walletState({
          connect,
          connecting: true,
          walletName: "Phantom",
        });
      }),
    });

    await executeSvmWalletConnect({
      getCurrent: () => current,
      walletName: "Phantom",
      waitForAutoConnect: async () => undefined,
    });

    expect(connect).not.toHaveBeenCalled();
  });

  it("falls back to connect when autoConnect did not start", async () => {
    const connect = vi.fn(async () => undefined);
    let current = walletState({
      connect,
      select: vi.fn(() => {
        current = walletState({ connect, walletName: "Phantom" });
      }),
    });

    await executeSvmWalletConnect({
      getCurrent: () => current,
      walletName: "Phantom",
      waitForAutoConnect: async () => undefined,
    });

    expect(connect).toHaveBeenCalledOnce();
  });

  it("does not connect a different wallet selected during the grace period", async () => {
    const connect = vi.fn(async () => undefined);
    let releaseAutoConnect: (() => void) | undefined;
    const autoConnectWindow = new Promise<void>((resolve) => {
      releaseAutoConnect = resolve;
    });
    let current = walletState({
      connect,
      walletName: "Phantom",
    });

    const attempt = executeSvmWalletConnect({
      getCurrent: () => current,
      walletName: "Phantom",
      waitForAutoConnect: () => autoConnectWindow,
    });
    current = walletState({ connect, walletName: "Solflare" });
    releaseAutoConnect?.();
    await attempt;

    expect(connect).not.toHaveBeenCalled();
  });
});

describe("v1 signing capability", () => {
  const address = "So11111111111111111111111111111111111111112";

  function standardAdapter(versions: readonly (string | number)[]) {
    const signTransaction = vi.fn(
      async (...inputs: { transaction: Uint8Array }[]) =>
        inputs.map(({ transaction }) => ({ signedTransaction: transaction })),
    );
    return {
      signTransaction,
      adapter: {
        standard: true,
        wallet: {
          accounts: [{ address, features: ["solana:signTransaction"] }],
          features: {
            "solana:signTransaction": {
              supportedTransactionVersions: versions,
              signTransaction,
            },
          },
        },
      },
    };
  }

  it("signs raw bytes when the wallet lists version 1", async () => {
    const { adapter, signTransaction } = standardAdapter(["legacy", 0, 1]);
    const signer = standardV1Signer(adapter, address);
    const bytes = Uint8Array.from([0x81, 1]);

    expect(signer).toBeTypeOf("function");
    await expect(signer!([bytes])).resolves.toEqual([bytes]);
    expect(signTransaction).toHaveBeenCalledWith({
      account: adapter.wallet.accounts[0],
      transaction: bytes,
    });
  });

  it.each([
    [
      "lists only legacy and 0",
      standardAdapter(["legacy", 0]).adapter,
      address,
    ],
    [
      "is not a Wallet Standard wallet",
      { ...standardAdapter([1]).adapter, standard: false },
      address,
    ],
    [
      "has no account for the connected key",
      standardAdapter([1]).adapter,
      "AnotherWallet",
    ],
    ["is disconnected", standardAdapter([1]).adapter, undefined],
  ])("gives no v1 signer when the wallet %s", (_case, adapter, key) => {
    expect(standardV1Signer(adapter, key)).toBeUndefined();
  });

  it("reports canSignV1Transaction only with a v1 signer", () => {
    const connected = walletState({ publicKey: address });
    expect(getSvmCapabilitySnapshot(connected)?.canSignV1Transaction).toBe(
      false,
    );
    expect(
      getSvmCapabilitySnapshot({
        ...connected,
        signV1Transactions: async (txs) => [...txs],
      })?.canSignV1Transaction,
    ).toBe(true);
  });
});
