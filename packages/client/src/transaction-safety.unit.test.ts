import { describe, expect, it, vi } from "vitest";
import {
  TransactionSafetyTransport,
  transactionSafetyPolicy,
} from "./transaction-safety";
import { reviewEligibility } from "./commit-lifecycle";
import type { ActionRequest } from "./agent/types";
import type { TransactionSafetyProjection } from "./transaction-safety";
const safety: TransactionSafetyProjection = {
  assessment: {
    version: 1,
    candidateDigest: "candidate",
    assessmentDigest: "assessment",
    registryVersion: "1",
    state: "complete",
    coverage: "generic",
    supportedOperationCount: 0,
    totalOperationCount: 1,
    findings: [
      {
        id: "critical",
        code: "critical",
        severity: "critical",
        message: "Unlimited approval",
        operationIds: ["0"],
      },
    ],
    limitations: [],
  },
  decision: {
    mode: "yolo",
    policyRevision: 4,
    assessmentDigest: "assessment",
    eligibility: "eligible",
    reasonCode: "critical_warning_allowed",
    bypassedFindingIds: ["critical"],
    bypassedRequirements: ["simulation_passed"],
  },
  authority: { eligibility: "eligible", reasonCode: "authority_valid" },
  simulationStatus: "failed",
};
describe("transaction safety client", () => {
  it("uses v2 eligibility without rewriting failed simulation or critical findings", () => {
    const request: ActionRequest = {
      type: "sign",
      requestId: "signature",
      chainFamily: "evm",
      executionKind: "evm_personal",
      signer: "owner",
      description: "Sign",
      payloads: [{ kind: "evm_personal", message: "message" }],
      transactionSafety: safety,
    };
    expect(reviewEligibility(request)).toEqual({
      state: "eligible",
      reason: "Only generic checks cover this request",
    });
    expect(safety.simulationStatus).toBe("failed");
    expect(safety.assessment.findings[0].severity).toBe("critical");
    expect(
      reviewEligibility({
        ...request,
        transactionSafety: {
          ...safety,
          authority: { eligibility: "blocked", reasonCode: "revoked_grant" },
        },
      }),
    ).toEqual({ state: "blocked", reason: "revoked_grant" });
  });
  it("gives an eligible request's coverage limits as its reason", () => {
    const request = (
      assessment: Partial<TransactionSafetyProjection["assessment"]>,
    ): ActionRequest => ({
      type: "execute_evm",
      transactions: [],
      transactionSafety: {
        ...safety,
        assessment: { ...safety.assessment, ...assessment },
      },
    });
    const limitation = (code: string, message: string) => ({
      code,
      message,
      operationIds: ["0"],
    });
    expect(
      reviewEligibility(
        request({
          coverage: "partial",
          limitations: [
            limitation(
              "guard_not_vouched",
              "No package vouches for this guard",
            ),
            limitation(
              "guard_not_vouched",
              "No package vouches for this guard",
            ),
            limitation("unsupported_operation", "No supported guard profile"),
          ],
        }),
      ),
    ).toEqual({
      state: "eligible",
      reason: "No package vouches for this guard · No supported guard profile",
    });
    expect(
      reviewEligibility(
        request({
          coverage: "supported",
          limitations: [limitation("unverified_counterparty", "Unverified")],
        }),
      ),
    ).toEqual({ state: "eligible", reason: undefined });
  });

  it("requires expected revision and preserves authoritative response", async () => {
    const policy = {
      mode: "strict",
      revision: 5,
      scope: "thread",
      source: "user",
    };
    const request = vi.fn().mockResolvedValue(Response.json(policy));
    const client = new TransactionSafetyTransport(request);
    expect(await client.setThread("owned/chat", "strict", 4)).toEqual(policy);
    expect(request).toHaveBeenCalledWith(
      "PUT",
      "/v1/account/transaction-safety/threads/owned%2Fchat",
      expect.objectContaining({
        body: { mode: "strict", expectedRevision: 4 },
      }),
    );
    await expect(client.setThread("chat", "balanced", 0)).rejects.toThrow(
      "positive policy revision",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not coerce malformed policy into Balanced", () => {
    expect(() =>
      transactionSafetyPolicy({
        mode: "unknown",
        revision: 1,
        scope: "thread",
        source: "user",
      }),
    ).toThrow();
    expect(() =>
      transactionSafetyPolicy({
        mode: "balanced",
        revision: 0,
        scope: "thread",
        source: "user",
      }),
    ).toThrow();
  });
});
