import { describe, expect, it } from "vitest";
import { svmTransactionLabel } from "./transaction-label";

describe("saved Solana transaction labels", () => {
  it.each([
    "svm bundle of 1 instruction",
    "svm bundle of 1 instructions",
    "",
    "Solana transaction",
  ])(
    "recovers the action behind %j without requiring every instruction to have a description",
    (description) => {
      expect(
        svmTransactionLabel({
          description,
          instructions: [
            { program_id: "old-program" },
            {
              program_id: "ComputeBudget111111111111111111111111111111",
              description: "compute_budget",
            },
            { program_id: "transfer-program", description: "Transfer SOL" },
            { program_id: "transfer-program", description: "Transfer SOL" },
          ],
        }),
      ).toBe("Transfer SOL");
    },
  );

  it("retains a useful transaction title and falls back safely when all instruction titles are missing", () => {
    const instructions = [{ program_id: "old-program" }];
    expect(
      svmTransactionLabel({ description: "Swap SOL to USDC", instructions }),
    ).toBe("Swap SOL to USDC");
    expect(
      svmTransactionLabel({
        description: "svm bundle of 1 instructions",
        instructions,
      }),
    ).toBe("Solana transaction");
    expect(
      svmTransactionLabel({ description: "", instructions }, "Transfer SOL"),
    ).toBe("Transfer SOL");
  });
});
