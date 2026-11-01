"use client";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useAomiRuntime } from "@aomi-labs/react";
import type { CommitController, CommitView } from "@aomi-labs/client";
import {
  projectCommitLifecycle,
  reviewEligibility,
  requiresSignatureAdmission,
  MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import { selectLegacyReviewAction, selectReviewQueue } from "./model";
import { TransactionReview } from "./transaction-review";
import { useSignerSwitch } from "./signer-switch";

const ParkedReview = lazy(() =>
  import("@/commit/approval").then((module) => ({
    default: module.ParkedReview,
  })),
);

/** One reviewed group (a batch) as it stood when its send was pressed. A
 * commit that was not batched stands alone under its own id. */
type ReviewedBatch = {
  batchId: string;
  reviewDigest: string;
  orderedCommitIds: readonly string[];
};

type BatchSubmission = {
  controller: CommitController;
  threadId: string;
  batches: readonly ReviewedBatch[];
  attemptedIds: readonly string[];
  controllerGeneration: number;
};

function matchesReviewedBatch(
  view: CommitView,
  reviewed: ReviewedBatch,
  index: number,
): boolean {
  const ids = reviewed.orderedCommitIds;
  const digestMatches =
    !view.review || view.review.digest === reviewed.reviewDigest;
  if (!view.batch)
    return (
      digestMatches &&
      ids.length === 1 &&
      index === 0 &&
      reviewed.batchId === view.commit_id
    );
  return (
    digestMatches &&
    view.batch.batch_id === reviewed.batchId &&
    view.batch.index === index &&
    view.batch.review_digest === reviewed.reviewDigest &&
    view.batch.ordered_commit_ids.length === ids.length &&
    view.batch.ordered_commit_ids.every((id, i) => id === ids[i])
  );
}

/** The batch a queued commit belongs to, when every leg still matches the
 * digest the user is reviewing. */
function reviewedBatchOf(
  commit: CommitView,
  commits: readonly CommitView[],
): ReviewedBatch | undefined {
  const batch = commit.batch;
  const reviewed = batch
    ? {
        batchId: batch.batch_id,
        reviewDigest: batch.review_digest,
        orderedCommitIds: batch.ordered_commit_ids,
      }
    : commit.review && {
        batchId: commit.commit_id,
        reviewDigest: commit.review.digest,
        orderedCommitIds: [commit.commit_id],
      };
  if (!reviewed || commit.review?.digest !== reviewed.reviewDigest) return;
  const intact = reviewed.orderedCommitIds.every((id, index) => {
    const view = commits.find((candidate) => candidate.commit_id === id);
    return (
      view?.thread_id === commit.thread_id &&
      matchesReviewedBatch(view, reviewed, index)
    );
  });
  return intact ? reviewed : undefined;
}

function walletMismatchMessage(failureCode: string | null | undefined): string {
  const reason =
    failureCode === "commit_wallet_transaction_nonce_mismatch"
      ? "The wallet used a different nonce from the prepared transaction."
      : "The submitted transaction did not match the reviewed request.";
  return `${reason} Aomi could not verify this transaction. Check its on-chain result before submitting another transaction.`;
}

// Only outcomes that need the user's attention get a line under the review.
// Progress phases (wallet prompt, network switch, waiting on a predecessor)
// already show in the Submit button and the transaction card's progress bar.
const NOTICE_PHASES = new Set([
  "checking_submission",
  "rejected",
  "failed",
  "expired",
]);

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
  const queue = selectReviewQueue(commits, commitController);
  const liveCommit = queue[0];
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
  const recovery = liveCommit
    ? commitController?.recoveryRecord?.(liveCommit.commit_id)
    : undefined;
  const lifecycle = liveCommit
    ? projectCommitLifecycle(
        liveCommit,
        commitController?.submissionPhase?.(liveCommit.commit_id),
        recovery,
        commitController?.onChainOutcome?.(liveCommit.commit_id),
      )
    : undefined;
  const recoveringExistingAttempt = Boolean(
    liveCommit?.wallet_attempt || recovery?.attemptId,
  );
  const commitCanExecute = Boolean(
    commitController && liveCommit && commitController.canExecute(liveCommit),
  );
  const checkingSubmission = lifecycle?.phase === "checking_submission";
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

  // Awaiting this browser's wallet with another wallet active: switch, not Submit.
  const signerSwitch = useSignerSwitch(
    liveCommit?.action && !recoveringExistingAttempt && !approving
      ? liveCommit
      : undefined,
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
          if (approved && checkingSubmission && !commitCanExecute)
            await commitController.refresh(liveCommit.commit_id);
          else if (approved)
            await commitController.execute(liveCommit.commit_id);
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
      checkingSubmission,
      commitCanExecute,
      commitController,
      executeAction,
      liveAction,
      liveCommit,
      rejectAction,
      showNotification,
    ],
  );

  // Every reviewed batch still waiting on the wallet, in signing order. The
  // shown batch must be intact; later batches join only when they are too.
  const liveBatch = liveCommit && reviewedBatchOf(liveCommit, commits);
  const queuedBatches: ReviewedBatch[] = [];
  if (liveBatch) {
    queuedBatches.push(liveBatch);
    for (const commit of queue) {
      if (
        commit.thread_id !== liveCommit.thread_id ||
        queuedBatches.some((queued) =>
          queued.orderedCommitIds.includes(commit.commit_id),
        )
      )
        continue;
      const reviewed = reviewedBatchOf(commit, commits);
      if (reviewed) queuedBatches.push(reviewed);
    }
  }
  const queueIsReviewed = queuedBatches.length > 1;

  // The click fixes the exact reviewed batches. Later commits or a new thread
  // cannot join them, even when the same sidebar stays mounted.
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
    if (
      !liveCommit ||
      !batchSubmission.batches.some((queued) =>
        queued.orderedCommitIds.includes(liveCommit.commit_id),
      )
    ) {
      setBatchSubmission(null);
      return;
    }
    if (deciding || lock.current) return;
    const legs = batchSubmission.batches.flatMap((queued) =>
      queued.orderedCommitIds.map((id, index) => ({
        queued,
        index,
        view: commits.find((candidate) => candidate.commit_id === id),
      })),
    );
    if (
      legs.some(
        ({ queued, index, view }) =>
          view &&
          (view.thread_id !== batchSubmission.threadId ||
            !matchesReviewedBatch(view, queued, index) ||
            view.wallet_attempt?.state === "mismatched"),
      )
    ) {
      setBatchSubmission(null);
      return;
    }
    // Strictly in order: each send waits for every earlier one to confirm,
    // which dependent legs inside a batch need anyway.
    const pending = legs.find(({ view }) => view?.state !== "confirmed");
    if (!pending) {
      setBatchSubmission(null);
      return;
    }
    const next = pending.view;
    if (!next) return;
    if (["rejected", "failed", "expired"].includes(next.state)) {
      setBatchSubmission(null);
      return;
    }
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

  // Send these groups in order: the shown one alone, or with Submit all
  // every queued one.
  const submit = (batches: readonly ReviewedBatch[]) => {
    if (!liveCommit || !commitController || batchSubmission) return;
    setBatchSubmission({
      controller: commitController,
      threadId: liveCommit.thread_id,
      batches: batches.map((queued) => ({
        ...queued,
        orderedCommitIds: [...queued.orderedCommitIds],
      })),
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
  // Parked for approval: Aomi signs after Approve, so no wallet step here.
  if (liveCommit?.state === "awaiting_approval")
    return (
      <ReviewPresence>
        <Suspense fallback={null}>
          <ParkedReview key={liveCommit.commit_id} commit={liveCommit} />
        </Suspense>
      </ReviewPresence>
    );
  if (!review) return <ReviewPresence />;
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
          : lifecycle?.onChain ||
              (lifecycle && NOTICE_PHASES.has(lifecycle.phase))
            ? lifecycle.label
            : undefined;
  // While a send runs, progress counts the groups pinned at the click.
  const groups = batchSubmission?.batches ?? queuedBatches;
  const groupIndex = liveCommit
    ? groups.findIndex((queued) =>
        queued.orderedCommitIds.includes(liveCommit.commit_id),
      )
    : -1;
  const showBatchControls =
    groups.length > 1 &&
    groupIndex >= 0 &&
    (queueIsReviewed || Boolean(batchSubmission));
  const plan = liveCommit && commitController?.plan?.(liveCommit);

  const remaining = showBatchControls
    ? groups
        .slice(groupIndex)
        .flatMap((queued) => queued.orderedCommitIds)
        .map((id) => commitController?.review(id))
    : [review.request];
  const cohortBlocked = remaining.some(
    (request) =>
      !request ||
      reviewEligibility(request)?.state === "blocked" ||
      reviewEligibility(request)?.state === "unresolved",
  );
  return (
    <ReviewPresence>
      <TransactionReview
        review={review}
        approveAllDisabled={cohortBlocked}
        supportedChains={wallet.supportedChains}
        approving={approving}
        submitting={Boolean(batchSubmission)}
        prompts={plan?.prompts}
        approveDisabled={
          (Boolean(liveCommit) && !commitCanExecute && !checkingSubmission) ||
          eligibilityBlocksNewAttempt ||
          signatureAdmissionUnavailable ||
          Boolean(signerSwitch.note)
        }
        connect={signerSwitch.connect}
        note={signerSwitch.note}
        rejectDisabled={Boolean(liveCommit && !liveCommit.action)}
        status={recovery?.walletError ?? status ?? signerSwitch.error}
        statusIsError={
          Boolean(recovery?.walletError || (!status && signerSwitch.error)) ||
          signatureAdmissionUnavailable ||
          walletMismatch ||
          lifecycle?.onChain === "reverted" ||
          (eligibilityBlocksNewAttempt && eligibility?.state === "blocked")
        }
        recoveringExistingAttempt={recoveringExistingAttempt}
        approveLabel={
          lifecycle?.phase === "checking_submission"
            ? "Check status"
            : lifecycle?.phase === "waiting_predecessor"
              ? "Waiting…"
              : undefined
        }
        onApprove={() =>
          liveBatch &&
          liveBatch.orderedCommitIds.length > 1 &&
          lifecycle?.phase === "ready"
            ? submit([liveBatch])
            : void decide(true)
        }
        onApproveAll={
          showBatchControls && groupIndex < groups.length - 1
            ? () => submit(queuedBatches)
            : undefined
        }
        batchProgress={
          showBatchControls
            ? { current: groupIndex + 1, total: groups.length }
            : undefined
        }
        onReject={() => {
          setBatchSubmission(null);
          void decide(false);
        }}
      />
    </ReviewPresence>
  );
}

/** Entry is the review's own fade-in; this keeps it mounted long enough to
 * collapse smoothly once it has been signed, rejected, or superseded. */
function ReviewPresence({ children }: { children?: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {children && (
        <m.div
          key="wallet-review"
          initial={false}
          exit={{ height: 0, opacity: 0, y: -4 }}
          transition={{
            duration: reduceMotion ? 0 : 0.24,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="overflow-hidden"
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}
