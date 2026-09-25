import { describe, expect, it } from "vitest";
import type { CommitView } from "../src/commits";
import {
  projectCommitLifecycle,
  reviewEligibility,
} from "../src/commit-lifecycle";

const ready: CommitView = {
  version: 1,
  commit_id: "commit-1",
  thread_id: "thread-1",
  stage_id: "evm:1",
  chain_family: "evm",
  chain_ref: "8453",
  signer: "0x1111111111111111111111111111111111111111",
  broadcaster: "wallet",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
  action: {
    kind: "start_wallet_send",
    review_digest: "digest",
    payload: {
      kind: "evm_transaction",
      chain_id: 8453,
      signer: "0x1111111111111111111111111111111111111111",
      nonce: 1,
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0x",
        gas_limit: 21000,
        max_fee_per_gas: "1",
        max_priority_fee_per_gas: "1",
      },
    },
  },
};

describe("commit lifecycle projection", () => {
  it("claims wallet approval only after the provider invocation begins", () => {
    expect(projectCommitLifecycle(ready).phase).toBe("ready");
    expect(projectCommitLifecycle(ready, "preparing").label).toBe(
      "Preparing wallet request",
    );
    expect(projectCommitLifecycle(ready, "switching_chain").label).toBe(
      "Switch network in your wallet",
    );
    expect(projectCommitLifecycle(ready, "awaiting_wallet").label).toBe(
      "Approve in your wallet",
    );
    expect(
      projectCommitLifecycle({
        ...ready,
        wallet_attempt: {
          attempt_id: "attempt-1",
          transport: "browser_send",
          state: "awaiting_wallet",
          transaction_id: null,
          failure_code: null,
        },
      }).phase,
    ).toBe("checking_submission");
  });

  it("keeps known chain outcomes ahead of transient local phases", () => {
    expect(
      projectCommitLifecycle(
        { ...ready, state: "confirmed", transaction_id: "0xhash" },
        "awaiting_wallet",
      ),
    ).toEqual({
      phase: "confirmed",
      label: "Confirmed",
      transactionId: "0xhash",
    });
  });

  it("treats explicit failed guards as blockers even after simulation passed", () => {
    const request = {
      type: "execute_evm" as const,
      transactions: [],
      simulation: {
        status: "passed" as const,
        balanceChanges: [],
        approvals: [],
        fees: [],
        gas: null,
        guards: [
          { name: "funding", status: "failed" as const, message: "Blocked" },
        ],
        logs: [],
        warnings: [],
      },
    };
    expect(reviewEligibility(request)).toEqual({
      state: "blocked",
      reason: "Blocked",
    });
  });
});
