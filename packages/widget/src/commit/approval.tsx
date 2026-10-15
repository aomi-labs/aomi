"use client";

/**
 * Approving a parked agent-wallet commit (`awaiting_approval`). Loaded lazily:
 * the sidebar card, the sign page and the scheduled-run strip only need it
 * once something is waiting.
 */
import { useEffect, useReducer, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useAomiRuntime } from "@aomi-labs/react";
import {
  AomiApiError,
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitStaleError,
  type CommitHandle,
  type CommitView,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { useAomiWalletKit } from "@/wallet/context";
import { TransactionReview } from "@/sidebar/activity/transaction-review";
import { useApprovalAuthority } from "./approval-authority";

export const APPROVAL_NOTE =
  "Aomi signs with your agent wallet after you approve.";

/** The fixed turn that asks the model to stage an expired trade again. */
export function retryText(ref: string): string {
  return `Retry the trade that expired (ref \`${ref.slice(0, 8)}\`).`;
}

function approveLabel(commit: CommitView): string {
  const legs = commit.batch?.ordered_commit_ids.length ?? 1;
  return legs > 1 ? `Approve all ${legs}` : "Approve";
}

function approvalError(error: unknown): string {
  if (error instanceof CommitStaleError)
    return "This request changed. Review it again.";
  if (error instanceof CommitExpiredError)
    return "Expired · nothing was signed";
  if (error instanceof AomiApiError)
    return error.code === "commit_signing_denied"
      ? "This wallet is paused. Unpause it in Settings → Safety."
      : "Couldn't approve right now. Try again.";
  return error instanceof Error ? error.message : "The request failed";
}

/** Runs one approve or reject at a time and keeps its error line. */
function useApprovalStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [changed, setChanged] = useState(false);
  const run = async (
    step: () => Promise<unknown>,
    onError?: (caught: unknown) => boolean | void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setChanged(false);
    try {
      await step();
    } catch (caught) {
      if (
        caught instanceof CommitStaleError &&
        caught.code === "commit_gas_stale"
      )
        setChanged(true);
      if (!onError?.(caught)) setError(approvalError(caught));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, changed, run };
}

/**
 * The sidebar card for a parked commit: Approve (once for a whole batch) and
 * Reject. Where this session cannot approve (an embed), Approve opens the
 * commit's sign page on Aomi instead.
 */
export function ParkedReview({ commit }: { commit: CommitView }) {
  const { commitController, sendMessage, isRunning } = useAomiRuntime();
  const { supportedChains } = useAomiWalletKit();
  const authority = useApprovalAuthority();
  const [forbidden, setForbidden] = useState(false);
  const [signUrl, setSignUrl] = useState<string>();
  const { busy, error, changed, run } = useApprovalStep();
  const id = commit.commit_id;
  const linkOnly = !authority || forbidden;
  useEffect(() => {
    if (!linkOnly || !commitController) return;
    let live = true;
    commitController
      .refView(id)
      .then((view) => live && setSignUrl(view.sign_url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [commitController, id, linkOnly]);
  const request = commitController?.review(id);
  if (!commitController || !request) return null;
  if (changed)
    return (
      <ChangedApproval
        commit={commit}
        disabled={isRunning}
        onRetry={() =>
          void sendMessage(retryText(commit.batch?.ordered_commit_ids[0] ?? id))
        }
      />
    );
  return (
    <TransactionReview
      review={{
        id,
        revision: commit.review?.revision ?? commit.version,
        request,
      }}
      supportedChains={supportedChains}
      approving={busy}
      approveLabel={linkOnly ? "Approve on Aomi" : approveLabel(commit)}
      approveHref={linkOnly ? signUrl : undefined}
      approveDisabled={linkOnly}
      note={APPROVAL_NOTE}
      status={error}
      statusIsError={Boolean(error)}
      onApprove={() =>
        void run(
          () =>
            commitController.approve(id, {
              expectedVersion: commit.version,
              expectedReviewDigest: commit.review?.digest ?? "",
            }),
          (caught) => {
            if (caught instanceof CommitApprovalForbiddenError) {
              setForbidden(true);
              return true;
            }
            if (caught instanceof CommitStaleError)
              void commitController.refresh(id).catch(() => undefined);
          },
        )
      }
      onReject={() => void run(() => commitController.reject(id))}
    />
  );
}

/** Stale network caps need a newly staged trade, with fresh consent. */
function ChangedApproval({
  commit,
  disabled,
  onRetry,
}: {
  commit: CommitView;
  disabled?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      className="border-aomi-border bg-aomi-raised rounded-card type-meta mt-3 flex items-center justify-between gap-3 border p-3"
    >
      <span className="text-aomi-muted">
        This request changed. Nothing was signed.
      </span>
      {onRetry ? (
        <AomiButton size="sm" disabled={disabled} onClick={onRetry}>
          <RotateCcw />
          Retry
        </AomiButton>
      ) : (
        <a
          href={`/?thread=${encodeURIComponent(commit.thread_id)}`}
          className="underline"
        >
          Retry
        </a>
      )}
    </div>
  );
}

/** An approval that ran out of time: nothing was signed; Retry asks again. */
export function ExpiredApproval({ commit }: { commit: CommitView }) {
  const { sendMessage, isRunning } = useAomiRuntime();
  const [sent, setSent] = useState(false);
  if (sent) return null;
  return (
    <div
      role="status"
      className="border-aomi-border bg-aomi-raised rounded-card type-meta mt-3 flex items-center justify-between gap-3 border p-3"
    >
      <span className="text-aomi-muted">Expired · nothing was signed</span>
      <AomiButton
        size="sm"
        disabled={isRunning}
        onClick={() => {
          setSent(true);
          void sendMessage(
            retryText(commit.batch?.ordered_commit_ids[0] ?? commit.commit_id),
          );
        }}
      >
        <RotateCcw />
        Retry
      </AomiButton>
    </div>
  );
}

/**
 * A scheduled run of this chat parked a commit on its own hidden thread.
 * Review opens its sign page: in place on Aomi, in a new tab from an embed.
 */
export function ScheduledApproval({ refs }: { refs: readonly string[] }) {
  const { commitController } = useAomiRuntime();
  const authority = useApprovalAuthority();
  const [signUrl, setSignUrl] = useState<string>();
  const ref = refs[0]!;
  useEffect(() => {
    if (authority || !commitController) return;
    let live = true;
    commitController
      .refView(ref)
      .then((view) => live && setSignUrl(view.sign_url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [authority, commitController, ref]);
  const href = authority ? `/sign/${encodeURIComponent(ref)}` : signUrl;
  return (
    <p
      role="status"
      className="border-aomi-border bg-aomi-raised rounded-card type-meta mt-3 flex items-center justify-between gap-3 border p-3"
    >
      <span className="text-aomi-muted">
        A scheduled run is waiting for your approval
      </span>
      {href ? (
        <a
          href={href}
          {...(authority ? {} : { target: "_blank", rel: "noreferrer" })}
          className="text-aomi-fg font-medium hover:underline"
        >
          Review
        </a>
      ) : null}
    </p>
  );
}

/**
 * The sign page for a parked commit: no wallet to connect, only Approve
 * (Aomi then signs with the agent wallet) or Reject.
 */
export function CommitApprovePanel({ handle }: { handle: CommitHandle }) {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => handle.subscribe(rerender), [handle]);
  const { supportedChains } = useAomiWalletKit();
  const { busy, error, changed, run } = useApprovalStep();
  const view = handle.view;
  const review = handle.review;
  if (changed) return <ChangedApproval commit={view} />;
  if (!view.can_approve)
    return (
      <p role="status" className="type-meta text-aomi-muted mt-3">
        Sign in on Aomi to approve.
      </p>
    );
  if (!review)
    return (
      <p role="status" className="type-meta text-aomi-muted mt-3">
        This request has no review to show yet.
      </p>
    );
  const refresh = (caught: unknown) => {
    if (
      caught instanceof CommitStaleError ||
      caught instanceof CommitExpiredError
    )
      void handle.refresh().catch(() => undefined);
  };
  return (
    <TransactionReview
      review={{
        id: view.commit_id,
        revision: view.review?.revision ?? view.version,
        request: review,
      }}
      supportedChains={supportedChains}
      approving={busy}
      approveLabel={approveLabel(view)}
      note={APPROVAL_NOTE}
      status={error}
      statusIsError={Boolean(error)}
      onApprove={() => void run(() => handle.approve(), refresh)}
      onReject={() => void run(() => handle.reject(), refresh)}
    />
  );
}
