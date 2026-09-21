"use client";
import { useRef, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import { selectReviewCommit } from "./model";
import { TransactionReview } from "./transaction-review";

/** Presents the next durable Action and submits only an explicit user choice. */
export function WalletReview() {
  const {
    pendingActions,
    actionAttempts,
    commits = [],
    commitController,
    executeAction,
    rejectAction,
    showNotification,
  } = useAomiRuntime();
  const wallet = useAomiWalletKit();
  const liveAction = pendingActions[0];
  const liveCommit = selectReviewCommit(commits, commitController?.review);
  const attempt = liveAction ? actionAttempts.get(liveAction.id) : undefined;
  const lock = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const walletAttemptState = liveCommit?.wallet_attempt?.state;
  const commitCanExecute = Boolean(
    commitController && liveCommit && commitController.canExecute(liveCommit),
  );
  const recoverableWalletOutcome = Boolean(
    walletAttemptState && commitCanExecute,
  );
  const approving =
    deciding ||
    attempt?.state === "executing" ||
    attempt?.state === "responding" ||
    Boolean(
      walletAttemptState &&
      !recoverableWalletOutcome &&
      ["awaiting_wallet", "reported", "observing"].includes(walletAttemptState),
    );

  const decide = async (approved: boolean) => {
    if ((!liveAction && !liveCommit) || approving || lock.current) return;
    lock.current = true;
    setDeciding(true);
    try {
      if (liveAction) {
        if (approved) await executeAction(liveAction.id);
        else await rejectAction(liveAction.id, "Request rejected");
      } else if (liveCommit && commitController) {
        if (approved) await commitController.execute(liveCommit.commit_id);
        else await commitController.reject(liveCommit.commit_id);
      }
    } catch (error) {
      showNotification({
        type: "error",
        title:
          error instanceof Error ? error.message : "Action response failed",
        duration: 6000,
      });
    } finally {
      lock.current = false;
      setDeciding(false);
    }
  };

  const commitReview = liveCommit
    ? commitController?.review(liveCommit.commit_id)
    : undefined;
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
  const status =
    walletAttemptState === "mismatched"
      ? "Wallet transaction needs attention. It does not match the reviewed request."
      : recoverableWalletOutcome
        ? "Wallet transaction found. Continue to verify it."
        : walletAttemptState
          ? "Checking the wallet transaction…"
          : undefined;

  return (
    <TransactionReview
      review={review}
      supportedChains={wallet.supportedChains}
      approving={approving}
      approveDisabled={Boolean(liveCommit) && !commitCanExecute}
      rejectDisabled={Boolean(liveCommit && !liveCommit.action)}
      status={status}
      statusIsError={walletAttemptState === "mismatched"}
      onApprove={() => void decide(true)}
      onReject={() => void decide(false)}
    />
  );
}
