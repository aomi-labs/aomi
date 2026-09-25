import type { ActionRequest } from "./agent/types";
import type {
  CommitRecoveryRecord,
  CommitSubmissionPhase,
  CommitView,
} from "./commits";

export type CommitPresentation = {
  phase:
    | "ready"
    | "waiting_predecessor"
    | "unavailable"
    | "preparing"
    | "switching_chain"
    | "awaiting_wallet"
    | "checking_submission"
    | "submitted"
    | "confirmed"
    | "rejected"
    | "failed"
    | "expired";
  label: string;
  transactionId?: string;
};

/** Assistant delivery follows a terminal chain result on its own durable path. */
export function projectCommitContinuation(
  view: CommitView,
): string | undefined {
  if (!view.continuation) return undefined;
  switch (view.continuation.state) {
    case "pending":
      return "Assistant follow-up pending";
    case "retrying":
      return "Assistant follow-up retrying";
    case "assistant_recovery_required":
      return "Assistant response needs recovery";
    case "exhausted":
      return "Assistant response unavailable after retries";
    case "completed":
      return undefined;
  }
}

/** Consumes only eligibility facts already present in a review. The current
 * wire contract does not say whether simulation/guards were required when
 * `simulation` is absent; the client must leave that case to server admission
 * rather than invent an eligibility rule. An empty guard list is not a blocker. */
export function reviewEligibility(
  request: ActionRequest | undefined,
):
  | { state: "eligible" | "blocked" | "unresolved"; reason?: string }
  | undefined {
  if (!request || request.type === "sign" || !request.simulation)
    return undefined;
  const simulation = request.simulation;
  const failedGuard = simulation.guards.find(
    (guard) => guard.status === "failed",
  );
  if (failedGuard)
    return {
      state: "blocked",
      reason: failedGuard.message ?? `${failedGuard.name} blocked execution`,
    };
  if (simulation.status === "failed")
    return { state: "blocked", reason: "Simulation failed" };
  if (
    simulation.status !== "passed" ||
    simulation.guards.some(
      (guard) => !["passed", "warning"].includes(guard.status),
    )
  )
    return {
      state: "unresolved",
      reason: "Execution eligibility is unresolved",
    };
  return { state: "eligible" };
}

/** One semantic projection for transcript, review, and activity surfaces.
 * `awaiting_wallet` in a durable record means the attempt exists; after a
 * reload it does not prove that a provider prompt is still open. */
export function projectCommitLifecycle(
  view: CommitView,
  phase?: CommitSubmissionPhase,
  recovery?: CommitRecoveryRecord,
): CommitPresentation {
  const transactionId =
    view.transaction_id ??
    view.wallet_attempt?.transaction_id ??
    recovery?.transactionId ??
    undefined;
  if (view.state === "confirmed")
    return { phase: "confirmed", label: "Confirmed", transactionId };
  if (view.state === "rejected")
    return { phase: "rejected", label: "Rejected", transactionId };
  if (view.state === "failed")
    return {
      phase: "failed",
      label: view.failure_code
        ? `Transaction failed: ${view.failure_code}`
        : "Transaction failed",
      transactionId,
    };
  if (view.state === "expired")
    return { phase: "expired", label: "Request expired", transactionId };
  if (view.state === "submitted")
    return {
      phase: "submitted",
      label: "Submitted; confirming",
      transactionId,
    };
  if (view.wallet_attempt?.state === "mismatched")
    return {
      phase: "failed",
      label: "Submitted transaction did not match the reviewed request",
      transactionId,
    };
  if (
    view.wallet_attempt?.state === "reported" ||
    view.wallet_attempt?.state === "observing"
  )
    return {
      phase: "submitted",
      label: "Submitted; confirming",
      transactionId,
    };
  if (phase === "switching_chain")
    return { phase, label: "Switch network in your wallet", transactionId };
  if (phase === "awaiting_wallet")
    return { phase, label: "Approve in your wallet", transactionId };
  if (phase === "submitting")
    return {
      phase: "preparing",
      label: "Submitting transaction",
      transactionId,
    };
  if (phase === "preparing")
    return { phase, label: "Preparing wallet request", transactionId };
  if (view.wallet_attempt || recovery)
    return {
      phase: "checking_submission",
      label: "Checking submission status",
      transactionId,
    };
  if (!view.action && view.batch?.predecessor_commit_id)
    return {
      phase: "waiting_predecessor",
      label: "Waiting for previous transaction",
    };
  if (!view.action)
    return { phase: "unavailable", label: "Transaction not ready" };
  return { phase: "ready", label: "Ready to submit" };
}
