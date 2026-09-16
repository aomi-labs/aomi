import { getAddress, toHex, type Address, type Hex } from "viem";
import type { AAWalletCall } from "../aa";

export type Eip5792Call = {
  to: Address;
  data: Hex;
  value: Hex;
};

export type Eip5792SendCallsParams = {
  version: "2.0.0";
  from: Address;
  chainId: Hex;
  atomicRequired: false;
  calls: Eip5792Call[];
};

function normalizeAddress(value: string, field: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${field} must be a valid EVM address.`);
  }
}

function normalizeChainId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("chainId must be a positive safe integer.");
  }
  return value;
}

function normalizeData(value: Hex | undefined, index: number): Hex {
  const data = value ?? "0x";
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) {
    throw new Error(`Call ${index + 1} data must be a hex byte string.`);
  }
  return data.toLowerCase() as Hex;
}

export function toEip5792SendCallsParams(input: {
  from: string;
  chainId: number;
  calls: readonly AAWalletCall[];
}): Eip5792SendCallsParams {
  const chainId = normalizeChainId(input.chainId);
  if (input.calls.length === 0) {
    throw new Error("At least one EVM call is required.");
  }

  return {
    version: "2.0.0",
    from: normalizeAddress(input.from, "from"),
    chainId: toHex(chainId),
    atomicRequired: false,
    calls: input.calls.map((call, index) => {
      if (call.chainId !== chainId) {
        throw new Error("All calls must use the exported chainId.");
      }
      if (call.value < BigInt(0)) {
        throw new Error(`Call ${index + 1} value cannot be negative.`);
      }
      return {
        to: normalizeAddress(call.to, `Call ${index + 1} to`),
        data: normalizeData(call.data, index),
        value: toHex(call.value),
      };
    }),
  };
}
