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
    expect(reviewErrorTitle("nope")).toBe("Action response failed");
  });
});
