import { AomiApiError } from "@aomi-labs/client";
import { describe, expect, it } from "vitest";
import { reviewErrorTitle } from "./presentation";

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
