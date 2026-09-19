import { describe, expect, it, vi } from "vitest";
import { mainnet, base } from "viem/chains";
import { buildEvmExecutionRuntime } from "../../execution/execution-runtime";
import type { EvmWalletRuntime } from "../../runtime/evm/wallet-runtime";
import {
  parseCaip2EvmChainId,
  sendPrivyEmbeddedTransaction,
  switchPrivyEmbeddedChain,
  type PrivyEmbeddedEvmWallet,
} from "./privy-embedded-execution";

const OWNER = "0xac4f2C0e2C9C1B4C4E7C5f2b1a9d8e7C6b5A4321";

function embeddedWallet(overrides?: {
  chainId?: string;
  request?: ReturnType<typeof vi.fn>;
}): PrivyEmbeddedEvmWallet & {
  request: ReturnType<typeof vi.fn>;
  switchChain: ReturnType<typeof vi.fn>;
} {
  const request =
    overrides?.request ?? vi.fn(async () => "0x" + "1".repeat(64));
  const switchChain = vi.fn(async () => {});
  return {
    address: OWNER,
    chainId: overrides?.chainId ?? "eip155:1",
    switchChain,
    getEthereumProvider: async () => ({ request }),
    request,
  };
}

describe("parseCaip2EvmChainId", () => {
  it("reads the reference out of an eip155 CAIP-2 id", () => {
    expect(parseCaip2EvmChainId("eip155:8453")).toBe(8453);
  });

  it("ignores non-EVM and malformed ids", () => {
    expect(parseCaip2EvmChainId("solana:mainnet")).toBeUndefined();
    expect(parseCaip2EvmChainId(undefined)).toBeUndefined();
    expect(parseCaip2EvmChainId("eip155:not-a-number")).toBeUndefined();
  });
});

describe("switchPrivyEmbeddedChain", () => {
  it("skips the switch when the wallet is already on the chain", async () => {
    const wallet = embeddedWallet({ chainId: "eip155:8453" });
    await switchPrivyEmbeddedChain(wallet, 8453);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("switches when the wallet is on another chain", async () => {
    const wallet = embeddedWallet({ chainId: "eip155:1" });
    await switchPrivyEmbeddedChain(wallet, 8453);
    expect(wallet.switchChain).toHaveBeenCalledWith(8453);
  });
});

describe("sendPrivyEmbeddedTransaction", () => {
  it("broadcasts through the embedded provider after switching chains", async () => {
    const wallet = embeddedWallet({ chainId: "eip155:1" });

    const hash = await sendPrivyEmbeddedTransaction({
      wallet,
      owner: OWNER,
      chainId: 8453,
      to: "0x1111111111111111111111111111111111111111",
      value: BigInt(255),
      data: "0xdeadbeef",
    });

    expect(wallet.switchChain).toHaveBeenCalledWith(8453);
    expect(wallet.request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [
        {
          from: OWNER,
          to: "0x1111111111111111111111111111111111111111",
          value: "0xff",
          data: "0xdeadbeef",
        },
      ],
    });
    expect(hash).toMatch(/^0x/);
  });

  it("refuses to send from an address that is not the embedded EOA", async () => {
    const wallet = embeddedWallet();
    await expect(
      sendPrivyEmbeddedTransaction({
        wallet,
        owner: "0x9999999999999999999999999999999999999999",
        chainId: 1,
        to: "0x1111111111111111111111111111111111111111",
        value: BigInt(0),
      }),
    ).rejects.toThrow("not the requested sender");
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it("rejects a provider that answers with something other than a hash", async () => {
    const wallet = embeddedWallet({ request: vi.fn(async () => null) });
    await expect(
      sendPrivyEmbeddedTransaction({
        wallet,
        owner: OWNER,
        chainId: 1,
        to: "0x1111111111111111111111111111111111111111",
        value: BigInt(0),
      }),
    ).rejects.toThrow("invalid transaction hash");
  });
});

describe("embedded EOA execution through the shared executor", () => {
  /**
   * The regression this guards: with no `sendTransaction` and no Privy smart
   * wallet, the kit used to fall through to a wagmi connector that was never
   * connected, so a swap was rejected before any Privy prompt appeared.
   */
  it("sends a pending transaction from the embedded EOA", async () => {
    const wallet = embeddedWallet({ chainId: "eip155:1" });
    const evmRuntime = {
      activeConnector: undefined,
      capabilities: undefined,
      chainsById: { 1: mainnet, 8453: base },
      activeEvmConnection: { address: OWNER, chainId: 1 },
      shouldUseExternalSigner: false,
    } as unknown as EvmWalletRuntime;

    const runtime = buildEvmExecutionRuntime(evmRuntime, {
      chainsById: { 1: mainnet, 8453: base },
      currentChainId: 1,
      sendTransactionAsync: async (args) =>
        sendPrivyEmbeddedTransaction({
          wallet,
          owner: OWNER,
          chainId: args.chainId as number,
          to: args.to,
          value: args.value ?? BigInt(0),
          data: args.data,
        }),
      sendCallsSyncAsync: undefined,
      capabilities: undefined,
      waitForTransactionReceipt: async () => ({ status: "success" }),
    });

    expect(runtime.sendTransaction).toBeDefined();
    const result = await runtime.sendTransaction!({
      to: "0x1111111111111111111111111111111111111111",
      value: "0x0",
      data: "0xabcdef",
      chainId: 1,
    });

    expect(wallet.request).toHaveBeenCalledTimes(1);
    expect(result.txHash).toMatch(/^0x/);
  });
});
