import { describe, expect, it } from "vitest";
import { toEip5792SendCallsParams } from "../../src/cli/eip5792";

const FROM = "0x1111111111111111111111111111111111111111";
const FIRST_TO = "0x2222222222222222222222222222222222222222";
const SECOND_TO = "0x3333333333333333333333333333333333333333";

describe("toEip5792SendCallsParams", () => {
  it("serializes canonical quantities and preserves call order", () => {
    expect(
      toEip5792SendCallsParams({
        from: FROM,
        chainId: 4326,
        calls: [
          {
            to: FIRST_TO,
            value: 0n,
            data: undefined,
            chainId: 4326,
          },
          {
            to: SECOND_TO,
            value: 1_000_000_000_000_000n,
            data: "0xAABB",
            chainId: 4326,
          },
        ],
      }),
    ).toEqual({
      version: "2.0.0",
      from: FROM,
      chainId: "0x10e6",
      atomicRequired: false,
      calls: [
        { to: FIRST_TO, data: "0x", value: "0x0" },
        {
          to: SECOND_TO,
          data: "0xaabb",
          value: "0x38d7ea4c68000",
        },
      ],
    });
  });

  it("serializes Ethereum as 0x1 without a leading zero", () => {
    const result = toEip5792SendCallsParams({
      from: FROM,
      chainId: 1,
      calls: [{ to: FIRST_TO, value: 0n, data: "0x", chainId: 1 }],
    });

    expect(result.chainId).toBe("0x1");
  });

  it.each([
    {
      name: "an invalid sender",
      input: {
        from: "not-an-address",
        chainId: 1,
        calls: [{ to: FIRST_TO, value: 0n, chainId: 1 }],
      },
      error: "from must be a valid EVM address",
    },
    {
      name: "an invalid call target",
      input: {
        from: FROM,
        chainId: 1,
        calls: [{ to: "0x1234", value: 0n, chainId: 1 }],
      },
      error: "Call 1 to must be a valid EVM address",
    },
    {
      name: "odd-length calldata",
      input: {
        from: FROM,
        chainId: 1,
        calls: [{ to: FIRST_TO, value: 0n, data: "0x123", chainId: 1 }],
      },
      error: "Call 1 data must be a hex byte string",
    },
    {
      name: "a negative value",
      input: {
        from: FROM,
        chainId: 1,
        calls: [{ to: FIRST_TO, value: -1n, chainId: 1 }],
      },
      error: "Call 1 value cannot be negative",
    },
    {
      name: "a mixed call chain",
      input: {
        from: FROM,
        chainId: 1,
        calls: [{ to: FIRST_TO, value: 0n, chainId: 10 }],
      },
      error: "All calls must use the exported chainId",
    },
  ])("rejects $name", ({ input, error }) => {
    expect(() =>
      toEip5792SendCallsParams(
        input as Parameters<typeof toEip5792SendCallsParams>[0],
      ),
    ).toThrow(error);
  });

  it("requires at least one call and a positive safe chain ID", () => {
    expect(() =>
      toEip5792SendCallsParams({ from: FROM, chainId: 1, calls: [] }),
    ).toThrow("At least one EVM call is required");
    expect(() =>
      toEip5792SendCallsParams({
        from: FROM,
        chainId: 0,
        calls: [{ to: FIRST_TO, value: 0n, chainId: 0 }],
      }),
    ).toThrow("chainId must be a positive safe integer");
  });
});
