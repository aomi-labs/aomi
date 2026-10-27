"use client";

import { useOptionalAomiRuntime } from "@aomi-labs/react";

/** One accessible live status also drives the current row's CSS indicator. */
export function CurrentThreadStatus() {
  const runtime = useOptionalAomiRuntime();
  const approving = runtime?.commits?.some(
    (commit) => commit.state === "awaiting_approval",
  );
  const status =
    approving ||
    runtime?.pendingActions?.length ||
    runtime?.commits?.some(
      // Once approved, Aomi signs; nothing waits on the user.
      (commit) =>
        commit.state === "needs_signature" &&
        commit.approval?.state !== "approved",
    )
      ? "sign"
      : runtime?.isRunning
        ? "run"
        : "idle";
  return (
    <span role="status" className="sr-only" data-current-thread-status={status}>
      {approving
        ? "Waiting for your approval"
        : status === "sign"
          ? "Waiting for your signature"
          : status === "run"
            ? "Working"
            : ""}
    </span>
  );
}
