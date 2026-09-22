import { describe, expect, it } from "vitest";

import { stringifyE2EPayload } from "./e2e-wallet-provider";

describe("E2E wallet payload hashing", () => {
  it("serializes bigint EIP-712 fields losslessly and deterministically", () => {
    const payload = {
      message: {
        value: 13_220_000n,
        validAfter: 0n,
        validBefore: 1_788_131_977n,
      },
    };

    expect(stringifyE2EPayload(payload)).toBe(
      '{"message":{"value":"13220000","validAfter":"0","validBefore":"1788131977"}}',
    );
    expect(() => stringifyE2EPayload(payload)).not.toThrow();
  });
});
