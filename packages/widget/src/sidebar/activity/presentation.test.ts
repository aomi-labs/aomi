import { AomiApiError } from "@aomi-labs/client";
import { describe, expect, it } from "vitest";
import { reviewErrorTitle, transactionTitle } from "./presentation";

describe("reviewErrorTitle", () => {
  it("keeps the network's reason for a refused send, not its logs", () => {
    const error = new Error(
      'Simulation failed. Message: Transaction simulation failed: Error processing Instruction 6: Computational budget exceeded. Logs: [ "Program L2TE invoke [1]" ]. Catch the `SendTransactionError` and call `getLogs()` on it for full details.',
    );
    expect(reviewErrorTitle(error)).toBe(
      "The network refused the transaction: Computational budget exceeded.",
    );
    expect(reviewErrorTitle(new Error("User rejected"))).toBe("User rejected");
    expect(reviewErrorTitle(new Error("commit_signed_out_of_compute"))).toMatch(
      /ran out of compute, so nothing was sent/,
    );
    expect(reviewErrorTitle(new Error("commit_signed_would_fail"))).toMatch(
      /would fail now, so nothing was sent/,
    );
    expect(reviewErrorTitle(new Error('HTTP 422: {"code":"commit_envelope_mismatch"}'))).toMatch(
      /changed the transaction beyond what it may, so nothing was sent/,
    );
    expect(
      reviewErrorTitle(
        new AomiApiError(422, "commit_signed_would_fail", "HTTP 422: Refused"),
      ),
    ).toMatch(/would fail now, so nothing was sent/);
    expect(reviewErrorTitle("nope")).toBe("Action response failed");
  });
});

describe("transactionTitle", () => {
  it("keeps an old one-line title to four words and a decoded call to its function", () => {
    const title = (label: string) => transactionTitle(label).title;
    expect(title("Swap 5 USDC to ETH")).toBe("Swap 5 USDC to…");
    expect(title("Approve USDC")).toBe("Approve USDC");
    expect(
      title(
        "pool.supply(asset: 0x8335…, amount: 1000000, onBehalfOf: wallet, referralCode: 0)",
      ),
    ).toBe("pool.supply(…)");
    expect(
      title("swap-router.multicall(data: [<896 bytes>]) with 0.1 native"),
    ).toBe("swap-router.multicall(…)");
    expect(title("vault.harvest()")).toBe("vault.harvest()");
    expect(transactionTitle("Approve USDC").details).toBeUndefined();
  });

  it("splits a two-line label into title and details", () => {
    expect(
      transactionTitle(
        "Aave supply\npool.supply(asset: usdc, amount: 1000000); integers in base units",
      ),
    ).toEqual({
      title: "Aave supply",
      details: "pool.supply(asset: usdc, amount: 1000000); integers in base units",
    });
  });
});
