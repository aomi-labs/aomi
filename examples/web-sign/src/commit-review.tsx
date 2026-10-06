import type { CommitView, Session } from "@aomi-labs/client";
import { useState } from "react";
import type { Abi } from "viem";

import { EvmReview } from "./ActionReview";
import type { InjectedWallet } from "./injected-wallet";

export interface CommitReviewProps {
  session: Session;
  commit: CommitView;
  wallet: InjectedWallet;
  allowedTargets: readonly string[];
  abi: Abi;
}

export function CommitReview({
  session,
  commit,
  wallet,
  allowedTargets,
  abi,
}: CommitReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = session.commits.review(commit.commit_id);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await (approve
        ? session.commits.execute(commit.commit_id, {
            expectedVersion: commit.version,
            expectedReviewDigest: commit.review?.digest,
          })
        : session.commits.reject(commit.commit_id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (["confirmed", "rejected", "failed", "expired"].includes(commit.state)) {
    return (
      <article className="review resolved">
        <h3>Durable transaction · {commit.state}</h3>
        {commit.transaction_id && <code>{commit.transaction_id}</code>}
        {commit.failure_code && <p className="error">{commit.failure_code}</p>}
      </article>
    );
  }

  if (!request) {
    return (
      <article className="review">
        <h3>Preparing durable transaction…</h3>
      </article>
    );
  }

  if (request.type !== "execute_evm") {
    return (
      <article className="review">
        <h3>Unsupported durable request: {request.type}</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Reject
        </button>
        {error && <p className="error">{error}</p>}
      </article>
    );
  }

  return (
    <EvmReview
      request={request}
      wallet={wallet}
      allowedTargets={allowedTargets}
      abi={abi}
      canExecute={session.commits.canExecute(commit)}
      busy={busy}
      error={error}
      title="Review durable transaction"
      onApprove={() => void decide(true)}
      onReject={() => void decide(false)}
    />
  );
}
