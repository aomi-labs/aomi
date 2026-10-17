"use client";

import { LazyMotion, domMax } from "motion/react";
import type { CommitReview, CommitView } from "@aomi-labs/client";
import type { ActivityTransaction } from "@/sidebar/activity/model";
import {
  TransactionCard,
  TransactionList,
} from "@/sidebar/activity/transactions";

/** The commit's transactions as the sidebar's cards, in signing order. */
export function commitTransactions(
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
      : [];
}

/**
 * The sign page's list of what will be signed: one card per transaction
 * with its Stage · Simulate · Commit · Signed progress, like the sidebar.
 */
export function CommitTransactions({
  view,
  review,
  executing = false,
}: {
  view: CommitView;
  review: CommitReview;
  executing?: boolean;
}) {
  const transactions = commitTransactions(view, review);
  if (!transactions.length) return null;
  return (
    <LazyMotion features={domMax}>
      <section aria-label="Transactions" className="w-full">
        <TransactionList
          newestId={transactions[0]?.id}
          count={transactions.length}
        >
          {transactions.map((tx) => (
            <TransactionCard
              key={tx.id}
              transaction={tx}
              reviewing
              current
              executing={executing}
            />
          ))}
        </TransactionList>
      </section>
    </LazyMotion>
  );
}
