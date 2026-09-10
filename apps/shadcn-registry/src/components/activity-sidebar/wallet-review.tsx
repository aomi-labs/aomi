"use client";
import { useRef, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import { TransactionReview } from "./transaction-review";

/** Presents the next durable Action and submits only an explicit user choice. */
export function WalletReview() {
  const {
    pendingActions,
    actionAttempts,
    executeAction,
    rejectAction,
    showNotification,
  } = useAomiRuntime();
  const wallet = useAomiWalletKit();
  const liveAction = pendingActions[0];
  const attempt = liveAction ? actionAttempts.get(liveAction.id) : undefined;
  const lock = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const approving =
    deciding ||
    attempt?.state === "executing" ||
    attempt?.state === "responding";

  const decide = async (approved: boolean) => {
    if (!liveAction || approving || lock.current) return;
    lock.current = true;
    setDeciding(true);
    try {
      if (approved) await executeAction(liveAction.id);
      else await rejectAction(liveAction.id, "Request rejected");
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

  if (!liveAction) return null;

  return (
    <TransactionReview
      action={liveAction}
      supportedChains={wallet.supportedChains}
      approving={approving}
      onApprove={() => void decide(true)}
      onReject={() => void decide(false)}
    />
  );
}
