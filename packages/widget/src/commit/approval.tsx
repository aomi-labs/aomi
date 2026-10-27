"use client";

/**
 * Approving a parked agent-wallet commit (`awaiting_approval`). Loaded lazily:
 * the sidebar card, the sign page and the scheduled-run strip only need it
 * once something is waiting.
 */
import { useEffect, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import {
  AomiApiError,
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitStaleError,
  isMessageCommit,
  type CommitHandle,
  type CommitView,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import { TransactionReview } from "@/sidebar/activity/transaction-review";
import { useApprovalAuthority } from "./approval-authority";

const APPROVAL_NOTE = "Aomi signs with your agent wallet after you approve.";

function approveLabel(commit: CommitView): string {
  if (isMessageCommit(commit)) return "Approve message";
  const legs = commit.batch?.ordered_commit_ids.length ?? 1;
  return legs > 1 ? `Approve ${legs} transactions` : "Approve transaction";
}

/** Why the agent wallet may not sign; Settings changes it. */
const REFUSALS: Record<string, string> = {
  commit_wallet_paused: "This wallet is paused. Nothing was signed.",
  commit_wallet_archived: "This wallet is archived. Nothing was signed.",
  commit_wallet_no_access:
    "This connection can't use this wallet. Nothing was signed.",
};

function approvalError(error: unknown): string {
  if (error instanceof CommitStaleError)
    return "This request changed. Review it again.";
  if (error instanceof CommitExpiredError)
    return "Expired · nothing was signed";
  if (error instanceof AomiApiError)
    return REFUSALS[error.code] ?? "Couldn't approve right now. Try again.";
  return error instanceof Error ? error.message : "The request failed";
}

/** Runs one approve or reject at a time and keeps its error line. */
function useApprovalStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (
    step: () => Promise<unknown>,
    onError?: (caught: unknown) => boolean | void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await step();
    } catch (caught) {
      if (!onError?.(caught)) setError(approvalError(caught));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** The commit's sign page URL, fetched while `enabled`. */
function useSignUrl(ref: string, enabled: boolean) {
  const { commitController } = useAomiRuntime();
  const [signUrl, setSignUrl] = useState<string>();
  useEffect(() => {
    if (!enabled || !commitController) return;
    let live = true;
    commitController
      .refView(ref)
      .then((view) => live && setSignUrl(view.sign_url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [commitController, enabled, ref]);
  return signUrl;
}

/**
 * The sidebar card for a parked commit: Approve (once for a whole batch) and
 * Reject. Where this session cannot approve (an embed), Approve opens the
 * commit's sign page on Aomi instead.
 */
export function ParkedReview({ commit }: { commit: CommitView }) {
  const { commitController } = useAomiRuntime();
  const { supportedChains } = useAomiWalletKit();
  const authority = useApprovalAuthority();
  const [forbidden, setForbidden] = useState(false);
  const { busy, error, run } = useApprovalStep();
  const id = commit.commit_id;
  const linkOnly = !authority || forbidden;
  const signUrl = useSignUrl(id, linkOnly);
  const request = commitController?.review(id);
  if (!commitController || !request) return null;
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

/**
 * A scheduled run of this chat parked a commit on its own hidden thread.
 * Review opens its sign page: in place on Aomi, in a new tab from an embed.
 */
export function ScheduledApproval({ refs }: { refs: readonly string[] }) {
  const authority = useApprovalAuthority();
  const ref = refs[0]!;
  const signUrl = useSignUrl(ref, !authority);
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
 * (Aomi then signs with the agent wallet) or Reject. While Aomi signs after
 * the approval (`signing`), Approve keeps spinning in place.
 */
export function CommitApprovePanel({
  handle,
  signing = false,
}: {
  handle: CommitHandle;
  signing?: boolean;
}) {
  const { supportedChains } = useAomiWalletKit();
  const { busy, error, run } = useApprovalStep();
  const view = handle.view;
  const review = handle.review;
  if (!view.can_approve && !signing)
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
      approving={busy || signing}
      approveLabel={approveLabel(view)}
      note={APPROVAL_NOTE}
      status={error}
      statusIsError={Boolean(error)}
      onApprove={() => void run(() => handle.approve(view), refresh)}
      onReject={() => void run(() => handle.reject(), refresh)}
    />
  );
}
