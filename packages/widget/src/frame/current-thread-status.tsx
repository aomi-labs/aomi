"use client";

import { useOptionalAomiRuntime } from "@aomi-labs/react";

/** One accessible live status also drives the current row's CSS indicator. */
export function CurrentThreadStatus() {
  const runtime = useOptionalAomiRuntime();
  const status =
    runtime?.pendingActions?.length ||
    runtime?.commits?.some((commit) => commit.state === "needs_signature")
      ? "sign"
      : runtime?.isRunning
        ? "run"
        : "idle";
  return (
    <span role="status" className="sr-only" data-current-thread-status={status}>
      {status === "sign"
        ? "Waiting for your signature"
        : status === "run"
          ? "Working"
          : ""}
    </span>
  );
}
