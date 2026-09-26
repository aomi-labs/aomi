import React from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, domAnimation } from "motion/react";
import type {
  ActionRequest,
  TransactionSafetyProjection,
} from "../../packages/client/src/index";
import {
  TransactionCard,
  TransactionList,
} from "../../apps/shadcn-registry/src/components/activity-sidebar/transactions";
import { TransactionReview } from "../../apps/shadcn-registry/src/components/activity-sidebar/transaction-review";
import { PolicyPage } from "../../apps/shadcn-registry/src/components/account-shell/features/policy/policy-page";
import "./style.css";

const safety: TransactionSafetyProjection = {
  assessment: {
    version: 1,
    candidateDigest: "candidate",
    assessmentDigest: "assessment",
    registryVersion: "1",
    state: "complete",
    coverage: "supported",
    supportedOperationCount: 1,
    totalOperationCount: 1,
    findings: [],
    limitations: [],
  },
  decision: {
    mode: "balanced",
    policyRevision: 3,
    assessmentDigest: "assessment",
    eligibility: "eligible",
    reasonCode: "checks_passed",
    bypassedFindingIds: [],
    bypassedRequirements: [],
  },
  authority: { eligibility: "eligible", reasonCode: "authority_valid" },
  simulationStatus: "passed",
};
const modify = (
  assessment = {},
  decision = {},
  authority = {},
  simulationStatus: TransactionSafetyProjection["simulationStatus"] = "passed",
): TransactionSafetyProjection => ({
  ...safety,
  assessment: { ...safety.assessment, ...assessment },
  decision: { ...safety.decision, ...decision },
  authority: { ...safety.authority, ...authority },
  simulationStatus,
});
const critical = [
  {
    id: "critical",
    code: "unlimited_approval",
    severity: "critical" as const,
    operationIds: ["0"],
    message:
      "Approval grants unlimited token spending to an unexpected spender.",
  },
];
const fixtures = [
  safety,
  modify({ coverage: "generic", supportedOperationCount: 0 }),
  modify({
    coverage: "partial",
    supportedOperationCount: 1,
    totalOperationCount: 2,
  }),
  modify({ state: "checking" }, { eligibility: "waiting" }),
  modify({ state: "unavailable" }, { eligibility: "waiting" }),
  modify({ state: "stale" }, { eligibility: "waiting" }),
  modify(
    { coverage: "generic", supportedOperationCount: 0 },
    { mode: "guarded_only", eligibility: "blocked" },
  ),
  modify({ findings: critical }, { eligibility: "blocked" }),
  modify(
    { findings: critical },
    { mode: "unrestricted", bypassedFindingIds: ["critical"] },
  ),
  modify(
    {},
    {},
    { eligibility: "blocked", reasonCode: "wallet_policy_restricted" },
  ),
  modify(
    {},
    { mode: "unrestricted", bypassedRequirements: ["simulation_passed"] },
    {},
    "failed",
  ),
  modify(
    {},
    { eligibility: "waiting", reasonCode: "simulation_pending" },
    {},
    "pending",
  ),
  modify({ findings: critical }, { eligibility: "blocked" }),
  modify({ findings: critical }, { eligibility: "blocked" }),
];
const request = (projection: TransactionSafetyProjection): ActionRequest => ({
  type: "execute_evm",
  transactions: [
    {
      chain_id: 8453,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0",
      data: "0x",
      label: "Call a contract",
      kind: "transaction",
    },
  ],
  simulation: {
    status: projection.simulationStatus === "failed" ? "failed" : "passed",
    balanceChanges: [],
    approvals: [],
    fees: [],
    gas: null,
    guards: [],
    logs: [],
    warnings: [],
  },
  transactionSafety: projection,
});
const params = new URLSearchParams(location.search);
if (params.get("dark") === "1") document.documentElement.classList.add("dark");
const width = Number(params.get("width") ?? 352);
createRoot(document.getElementById("root")!).render(
  <LazyMotion features={domAnimation}>
    <main style={{ width, maxWidth: "100%", margin: "auto", padding: 16 }}>
      <h1>Transaction safety</h1>
      <PolicyPage />
      <section aria-label="Safety fixture cards" className="mt-6">
        <TransactionList count={fixtures.length} newestId="0">
          {fixtures.map((_, index) => (
            <TransactionCard
              key={index}
              transaction={{
                id: String(index),
                turnId: "turn",
                family: "evm",
                label: "An exact transaction with a deliberately long title",
                kind: index === 12 ? "signature" : "transaction",
                chainId: 8453,
                raw: {},
                stage: "simulated",
                commit:
                  index === 13
                    ? {
                        version: 1,
                        commit_id: "automatic-blocked",
                        thread_id: "browser-chat",
                        stage_id: "evm:automatic",
                        chain_family: "evm",
                        chain_ref: "8453",
                        signer: "0x1111111111111111111111111111111111111111",
                        broadcaster: "hosted",
                        state: "needs_signature",
                        transaction_id: null,
                        failure_code: null,
                        batch: null,
                        review: null,
                        wallet_attempt: null,
                        action: null,
                        signing_mode: "auto",
                      }
                    : undefined,
              }}
              active={false}
              executing={false}
            />
          ))}
        </TransactionList>
      </section>
      <section aria-label="Danger review">
        <TransactionReview
          review={{ id: "danger", revision: 1, request: request(fixtures[8]) }}
          onApprove={() => {
            throw new Error("Fixture cannot invoke wallet");
          }}
          onReject={() => {}}
        />
      </section>
      <section aria-label="Mixed cohort">
        <TransactionReview
          review={{ id: "cohort", revision: 1, request: request(fixtures[0]) }}
          approveAllDisabled
          batchProgress={{ current: 1, total: 3, submitting: false }}
          onApprove={() => {}}
          onApproveAll={() => {
            throw new Error("Blocked cohort cannot invoke wallet");
          }}
          onReject={() => {}}
        />
      </section>
      <section aria-label="Recovery">
        <TransactionReview
          review={{
            id: "recovery",
            revision: 1,
            request: request(fixtures[8]),
          }}
          recoveringExistingAttempt
          approveLabel="Check status"
          onApprove={() => {}}
          onReject={() => {}}
        />
      </section>
    </main>
  </LazyMotion>,
);
