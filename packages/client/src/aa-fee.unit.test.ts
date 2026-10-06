import { describe, expect, it } from "vitest";
import type { WalletTxPayload } from "../../src/wallet-utils";
import type { AomiSimulateFee } from "../../src/types";
import {
  appendFeeCallToPayload,
  buildFeeAAWalletCall,
  normalizeSimulatedFee,
} from "../../src/aa";

function makeFee(amountWei: string): AomiSimulateFee {
  return {
    recipient: "0x1111111111111111111111111111111111111111",
    amount_wei: amountWei,
    token: "native",
  };
}

describe("aa fee helpers", () => {
  it("appends fee as final payload call and forces 7702-first AA strict mode", () => {
    const payload: WalletTxPayload = {
      to: "0x2222222222222222222222222222222222222222",
      value: "1",
      chainId: 1,
      txId: 7,
      aaPreference: "none",
    };

    const next = appendFeeCallToPayload(payload, makeFee("1000000000000000"), 1);

    expect(next.aaPreference).toBe("eip7702");
    expect(next.aaStrict).toBe(true);
    expect(next.calls).toHaveLength(2);
    expect(next.calls?.[0]).toMatchObject({
      to: "0x2222222222222222222222222222222222222222",
      value: "1",
      chainId: 1,
      txId: 7,
    });
    expect(next.calls?.[1]).toMatchObject({
      to: "0x1111111111111111111111111111111111111111",
      value: "1000000000000000",
      chainId: 1,
    });
  });

  it("reuses shared fee validation for CLI AA call construction", () => {
    const feeCall = buildFeeAAWalletCall(makeFee("1000000000000000"), 1);
    expect(feeCall).toMatchObject({
      to: "0x1111111111111111111111111111111111111111",
      value: 1000000000000000n,
      chainId: 1,
    });
  });

  it("returns null for zero fee", () => {
    expect(normalizeSimulatedFee(makeFee("0"))).toBeNull();
    expect(buildFeeAAWalletCall(makeFee("0"), 1)).toBeNull();
  });
});
