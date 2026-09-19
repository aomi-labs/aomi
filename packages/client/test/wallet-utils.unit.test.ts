import { describe, expect, it } from "vitest";
import {
  normalizeSolanaCluster,
  parseChainId,
  toAAWalletCalls,
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
} from "../src/wallet-utils";

describe("wallet adapter utilities", () => {
  it("normalizes supported Solana cluster names", () => {
    expect(normalizeSolanaCluster("mainnet-beta")).toBe("solana:mainnet");
    expect(normalizeSolanaCluster("devnet")).toBe("solana:devnet");
    expect(normalizeSolanaCluster("solana:testnet")).toBe("solana:testnet");
  });

  it("parses canonical decimal and hexadecimal chain ids", () => {
    expect(parseChainId("8453")).toBe(8453);
    expect(parseChainId("0x2105")).toBe(8453);
    expect(parseChainId("8453abc")).toBeUndefined();
    expect(parseChainId(1.5)).toBeUndefined();
  });

  it("converts wallet-kit calls at the wallet boundary", () => {
    expect(
      toAAWalletCalls({
        chainId: 1,
        calls: [
          {
            txId: 1,
            to: "0x1111111111111111111111111111111111111111",
            value: "42",
            data: "0x",
          },
        ],
      }),
    ).toEqual([
      {
        chainId: 1,
        to: "0x1111111111111111111111111111111111111111",
        value: 42n,
        data: "0x",
      },
    ]);
  });

  it("converts typed data without the EIP712Domain helper type", () => {
    expect(
      toViemSignTypedDataArgs({
        typed_data: {
          primaryType: "Permit",
          types: {
            EIP712Domain: [{ name: "name", type: "string" }],
            Permit: [{ name: "owner", type: "address" }],
          },
          message: { owner: "0x1111111111111111111111111111111111111111" },
        },
      }),
    ).toMatchObject({
      primaryType: "Permit",
      types: { Permit: [{ name: "owner", type: "address" }] },
    });
  });

  it("preserves hexadecimal personal-sign payloads as bytes", () => {
    expect(toViemSignMessageArgs({ non_typed_data: "0x0102" })).toEqual({
      message: { raw: "0x0102" },
    });
    expect(toViemSignMessageArgs({ non_typed_data: "hello" })).toEqual({
      message: "hello",
    });
  });
});
