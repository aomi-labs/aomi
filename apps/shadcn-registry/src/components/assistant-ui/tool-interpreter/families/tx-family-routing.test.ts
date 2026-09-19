import { describe, expect, it } from "vitest";

import type { ToolContext } from "../types";
import { matchEvmPendingApproval, matchEvmSimulation } from "./evm-tx";
import { matchSvmPendingApproval, matchSvmSimulation } from "./svm-tx";

const contextFor = (result: Record<string, unknown>): ToolContext => ({
  rawLabel: "Transaction step",
  parsedArgs: null,
  result,
  resultRecord: result,
  relatedResultRecords: [],
});

describe("transaction family routing", () => {
  it("routes Solana simulation only through the SVM matcher", () => {
    const context = contextFor({
      simulation: {
        err: null,
        logs: ["Program 11111111111111111111111111111111 success"],
        units_consumed: 450,
      },
      last_batch_status: "SVM ixs [1] passed",
      ix_ids: [1],
    });

    expect(matchSvmSimulation(context)?.id).toBe("svm.tx.simulate_batch");
    expect(matchEvmSimulation(context)).toBeNull();
  });

  it("routes Solana approval only through the SVM matcher", () => {
    const context = contextFor({
      status: "pending_approval",
      chain_kind: "svm",
      svm_ix_ids: [1, 2, 3],
      unsigned_tx: "AQAAAAAAAA",
    });

    expect(matchSvmPendingApproval(context)?.id).toBe(
      "svm.tx.pending_approval",
    );
    expect(matchEvmPendingApproval(context)).toBeNull();
  });

  it("keeps EVM simulation and approval in the EVM matcher", () => {
    const simulation = contextFor({
      simulation: {
        network: "base",
        batch_success: true,
        steps: [{ step: 1 }],
      },
    });
    const approval = contextFor({
      chain_id: 8453,
      status: "pending_approval",
      tx_ids: [1],
    });

    expect(matchEvmSimulation(simulation)?.id).toBe("evm.tx.simulate_batch");
    expect(matchSvmSimulation(simulation)).toBeNull();
    expect(matchEvmPendingApproval(approval)?.id).toBe(
      "evm.tx.pending_approval",
    );
    expect(matchSvmPendingApproval(approval)).toBeNull();
  });
});
