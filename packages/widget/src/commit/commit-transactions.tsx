"use client";

import { LazyMotion, domMax } from "motion/react";
import type { CommitHandle, CommitReview, CommitView } from "@aomi-labs/client";
import { isMessageReview, projectCommitLifecycle } from "@aomi-labs/client";
import type { ActivityTransaction } from "@/sidebar/activity/model";
import {
  TransactionCard,
  TransactionList,
} from "@/sidebar/activity/transactions";

/** The commit's transactions as the sidebar's cards, in signing order. */
function commitTransactions(
  view: CommitView,
  review: CommitReview,
): ActivityTransaction[] {
  const base = {
    turnId: null,
    raw: {},
    stage: "committed" as const,
    commit: view,
  };
  return review.type === "execute_evm"
    ? review.transactions.map((tx, index) => ({
        ...base,
        id: `${view.commit_id}:${index}`,
        family: "evm" as const,
        label: tx.label,
        kind: tx.kind,
        chainId: tx.chain_id,
      }))
    : review.type === "execute_svm"
      ? review.transactions.map((tx, index) => ({
          ...base,
          id: `${view.commit_id}:${index}`,
          family: "svm" as const,
          label: tx.description,
          kind: tx.kind,
          cluster: tx.cluster,
        }))
      : isMessageReview(review)
        ? [
            {
              ...base,
              id: `commit:${view.commit_id}`,
              family: view.chain_family,
              label: review.description || "Sign message",
              kind: "message",
              ...(view.chain_family === "svm"
                ? { cluster: view.chain_ref }
                : { chainId: Number(view.chain_ref) }),
            },
          ]
        : [];
}

/**
 * The sign page's list of what will be signed: one card per transaction
 * (or the message) with its Stage · Simulate · Commit · Signed progress,
 * like the sidebar. A batch's review lists every member's transaction, so
 * each card follows its own member.
 */
export function CommitTransactions({
  handle,
  review,
}: {
  handle: CommitHandle;
  review: CommitReview;
}) {
  const members = handle.members;
  const transactions = commitTransactions(handle.view, review);
  if (!transactions.length) return null;
  return (
    <LazyMotion features={domMax}>
      <section aria-label="Transactions" className="w-full">
        <TransactionList
          newestId={transactions[0]?.id}
          count={transactions.length}
        >
          {transactions.map((tx, index) => {
            const member =
              members.length > 1 ? (members[index] ?? handle.next) : handle;
            const outcome = projectCommitLifecycle(
              member.view,
              undefined,
              undefined,
              member.onChain,
            );
            return (
              <TransactionCard
                key={tx.id}
                transaction={{ ...tx, commit: member.groupView }}
                onChain={outcome.onChain ? outcome : undefined}
                reviewing
                current
                executing={[
                  "preparing",
                  "switching_chain",
                  "awaiting_wallet",
                ].includes(
                  projectCommitLifecycle(
                    member.view,
                    member.submissionPhase,
                    member.recoveryRecord,
                  ).phase,
                )}
              />
            );
          })}
        </TransactionList>
      </section>
    </LazyMotion>
  );
}
