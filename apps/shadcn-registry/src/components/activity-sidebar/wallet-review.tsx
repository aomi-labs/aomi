"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import type { CommitController } from "@aomi-labs/client";
import {
  projectCommitLifecycle,
  reviewEligibility,
  requiresSignatureAdmission,
  MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import { selectLegacyReviewAction, selectReviewCommit } from "./model";
import { TransactionReview } from "./transaction-review";

type BatchSubmission = {
  controller: CommitController;
  threadId: string;
  batchId: string;
  reviewDigest: string;
  orderedCommitIds: readonly string[];
  attemptedIds: readonly string[];
  controllerGeneration: number;
};

function walletMismatchMessage(failureCode: string | null | undefined): string {
  const reason =
    failureCode === "commit_wallet_transaction_nonce_mismatch"
      ? "The wallet used a different nonce from the prepared transaction."
      : "The submitted transaction did not match the reviewed request.";
  return `${reason} Aomi could not verify this transaction. Check its on-chain result before submitting another transaction.`;
}

/** Presents the next durable Action and submits only an explicit user choice. */
export function WalletReview() {
  const {
    pendingActions,
    actionAttempts,
    events,
    commits = [],
    commitController,
    executeAction,
    rejectAction,
    showNotification,
  } = useAomiRuntime();
  const wallet = useAomiWalletKit();
  const liveCommit = selectReviewCommit(commits, commitController?.review);
  // Durable commit state owns execution once it can present the review. Keep
  // unrelated pending Actions as compatibility for sessions without one.
  const liveAction = liveCommit
    ? undefined
    : selectLegacyReviewAction(events, pendingActions, commits);
  const attempt = liveAction ? actionAttempts.get(liveAction.id) : undefined;
  const lock = useRef(false);
  const controllerGeneration = useRef(0);
  useEffect(
    () => () => {
      controllerGeneration.current += 1;
    },
    [commitController],
  );
  const [deciding, setDeciding] = useState(false);
  const [batchSubmission, setBatchSubmission] =
    useState<BatchSubmission | null>(null);
  const walletAttemptState = liveCommit?.wallet_attempt?.state;
  const lifecycle = liveCommit
    ? projectCommitLifecycle(
        liveCommit,
        commitController?.submissionPhase?.(liveCommit.commit_id),
        commitController?.recoveryRecord?.(liveCommit.commit_id),
      )
    : undefined;
  const recoveringExistingAttempt = Boolean(
    liveCommit?.wallet_attempt ||
    (liveCommit &&
      commitController?.recoveryRecord?.(liveCommit.commit_id)?.attemptId),
  );
  const commitCanExecute = Boolean(
    commitController && liveCommit && commitController.canExecute(liveCommit),
  );
  const approving =
    deciding ||
    attempt?.state === "executing" ||
    attempt?.state === "responding" ||
    Boolean(
      lifecycle &&
      ["preparing", "switching_chain", "awaiting_wallet", "submitted"].includes(
        lifecycle.phase,
      ),
    );

  const decide = useCallback(
    async (approved: boolean, batchCommitId?: string): Promise<boolean> => {
      if (
        (!liveAction && !liveCommit && !batchCommitId) ||
        approving ||
        lock.current
      )
        return false;
      lock.current = true;
      setDeciding(true);
      try {
        if (batchCommitId && commitController) {
          const result = await commitController.execute(batchCommitId);
          return !["rejected", "failed", "expired"].includes(result.state);
        } else if (liveAction) {
          if (approved) await executeAction(liveAction.id);
          else await rejectAction(liveAction.id, "Request rejected");
        } else if (liveCommit && commitController) {
          if (approved) await commitController.execute(liveCommit.commit_id);
          else await commitController.reject(liveCommit.commit_id);
        }
        return true;
      } catch (error) {
        showNotification({
          type: "error",
          title:
            error instanceof Error ? error.message : "Action response failed",
          duration: 6000,
        });
        return false;
      } finally {
        lock.current = false;
        setDeciding(false);
      }
    },
    [
      approving,
      commitController,
      executeAction,
      liveAction,
      liveCommit,
      rejectAction,
      showNotification,
    ],
  );

  const batch = liveCommit?.batch;
  const batchIds = batch?.ordered_commit_ids;
  const batchIsReviewed = Boolean(
    liveCommit &&
    batch &&
    batchIds &&
    batchIds.length > 1 &&
    batchIds[batch.index] === liveCommit.commit_id &&
    batch.review_digest === liveCommit.review?.digest &&
    batchIds.every((id, index) => {
      const view = commits.find((candidate) => candidate.commit_id === id);
      return (
        view?.thread_id === liveCommit.thread_id &&
        view.batch?.batch_id === batch.batch_id &&
        view.batch.index === index &&
        view.batch.review_digest === batch.review_digest &&
        view.batch.ordered_commit_ids.length === batchIds.length &&
        view.batch.ordered_commit_ids.every(
          (orderedId, orderedIndex) => orderedId === batchIds[orderedIndex],
        ) &&
        (!view.review || view.review.digest === batch.review_digest)
      );
    }),
  );

  // The click fixes the exact reviewed batch. Later commits or a new thread
  // cannot join it, even when the same sidebar stays mounted.
  useEffect(() => {
    if (!batchSubmission) return;
    if (
      controllerGeneration.current !== batchSubmission.controllerGeneration ||
      !commitController ||
      commitController !== batchSubmission.controller ||
      commitController.threadId !== batchSubmission.threadId
    ) {
      setBatchSubmission(null);
      return;
    }
    if (liveAction) {
      setBatchSubmission(null);
      return;
    }
    if (!liveCommit || liveCommit.batch?.batch_id !== batchSubmission.batchId) {
      setBatchSubmission(null);
      return;
    }
    if (deciding || lock.current) return;
    const views = batchSubmission.orderedCommitIds.map((id) =>
      commits.find((candidate) => candidate.commit_id === id),
    );
    if (
      views.some(
        (view, index) =>
          view &&
          (view.thread_id !== batchSubmission.threadId ||
            view.batch?.batch_id !== batchSubmission.batchId ||
            view.batch.index !== index ||
            view.batch.review_digest !== batchSubmission.reviewDigest ||
            view.batch.ordered_commit_ids.length !==
              batchSubmission.orderedCommitIds.length ||
            view.batch.ordered_commit_ids.some(
              (id, orderedIndex) =>
                id !== batchSubmission.orderedCommitIds[orderedIndex],
            ) ||
            view.wallet_attempt?.state === "mismatched" ||
            (view.review &&
              view.review.digest !== batchSubmission.reviewDigest)),
      )
    ) {
      setBatchSubmission(null);
      return;
    }
    const nextIndex = views.findIndex((view) => view?.state !== "confirmed");
    if (nextIndex === -1) {
      setBatchSubmission(null);
      return;
    }
    const next = views[nextIndex];
    if (!next) return;
    if (["rejected", "failed", "expired"].includes(next.state)) {
      setBatchSubmission(null);
      return;
    }
    // Dependent sends wait for the previous on-chain confirmation.
    if (nextIndex > 0 && views[nextIndex - 1]?.state !== "confirmed") return;
    if (
      !["needs_signature", "awaiting_broadcast"].includes(next.state) ||
      !commitController.canExecute(next) ||
      batchSubmission.attemptedIds.includes(next.commit_id)
    )
      return;
    if (liveCommit?.commit_id !== next.commit_id) {
      setBatchSubmission(null);
      return;
    }
    setBatchSubmission(
      (current) =>
        current && {
          ...current,
          attemptedIds: [...current.attemptedIds, next.commit_id],
        },
    );
    void decide(true, next.commit_id).then((continued) => {
      if (!continued) setBatchSubmission(null);
    });
  }, [
    batchSubmission,
    commits,
    commitController,
    deciding,
    decide,
    liveAction,
    liveCommit,
  ]);

  const submitAll = () => {
    if (
      !batchIsReviewed ||
      !batch ||
      !batchIds ||
      !liveCommit ||
      !commitController ||
      batchSubmission
    )
      return;
    setBatchSubmission({
      controller: commitController,
      threadId: liveCommit.thread_id,
      batchId: batch.batch_id,
      reviewDigest: batch.review_digest,
      orderedCommitIds: [...batchIds],
      attemptedIds: [],
      controllerGeneration: controllerGeneration.current,
    });
  };

  const commitReview = liveCommit
    ? commitController?.review(liveCommit.commit_id)
    : undefined;
  const eligibility = reviewEligibility(commitReview);
  const eligibilityBlocksNewAttempt =
    !recoveringExistingAttempt &&
    (eligibility?.state === "blocked" || eligibility?.state === "unresolved");
  const review =
    liveAction ??
    (liveCommit && commitReview
      ? {
          id: liveCommit.commit_id,
          revision: liveCommit.review?.revision ?? liveCommit.version,
          request: commitReview,
        }
      : undefined);
  if (!review) return null;
  const signatureAdmissionUnavailable = requiresSignatureAdmission(
    review.request,
  );
  const walletMismatch = walletAttemptState === "mismatched";
  const status = signatureAdmissionUnavailable
    ? MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE
    : walletMismatch
      ? walletMismatchMessage(
          liveCommit?.wallet_attempt?.failure_code ?? liveCommit?.failure_code,
        )
      : eligibilityBlocksNewAttempt && eligibility?.state === "blocked"
        ? `Execution blocked: ${eligibility.reason ?? "review failed"}`
        : eligibilityBlocksNewAttempt && eligibility?.state === "unresolved"
          ? eligibility.reason
          : lifecycle?.phase === "ready" && batchSubmission
            ? "Submitting in order; waiting for each confirmation."
            : lifecycle?.label;
  const activeBatchReview = Boolean(
    batchSubmission &&
    liveCommit?.batch?.batch_id === batchSubmission.batchId &&
    liveCommit.batch.review_digest === batchSubmission.reviewDigest &&
    batchSubmission.orderedCommitIds[liveCommit.batch.index] ===
      liveCommit.commit_id,
  );
  const showBatchControls = batchIsReviewed || activeBatchReview;

  const remaining = batchIds
    ?.slice(batch?.index ?? 0)
    .map((id) => commitController?.review(id)) ?? [review.request];
  const cohortBlocked = remaining.some(
    (request) =>
      !request ||
      reviewEligibility(request)?.state === "blocked" ||
      reviewEligibility(request)?.state === "unresolved",
  );
  return (
    <TransactionReview
      review={review}
      approveAllDisabled={cohortBlocked}
      supportedChains={wallet.supportedChains}
      approving={approving}
      approveDisabled={
        (Boolean(liveCommit) && !commitCanExecute) ||
        eligibilityBlocksNewAttempt ||
        signatureAdmissionUnavailable
      }
      rejectDisabled={Boolean(liveCommit && !liveCommit.action)}
      status={status}
      statusTransactionId={lifecycle?.transactionId}
      statusIsError={
        signatureAdmissionUnavailable ||
        walletMismatch ||
        (eligibilityBlocksNewAttempt && eligibility?.state === "blocked")
      }
      recoveringExistingAttempt={recoveringExistingAttempt}
      approveLabel={
        lifecycle?.phase === "checking_submission" ? "Check status" : undefined
      }
      onApprove={() => void decide(true)}
      onApproveAll={
        showBatchControls && batch && batch.index < batchIds!.length - 1
          ? submitAll
          : undefined
      }
      batchProgress={
        showBatchControls && batch
          ? {
              current: batch.index + 1,
              total: batchIds!.length,
              submitting: Boolean(batchSubmission),
            }
          : undefined
      }
      onReject={() => {
        setBatchSubmission(null);
        void decide(false);
      }}
    />
  );
}
