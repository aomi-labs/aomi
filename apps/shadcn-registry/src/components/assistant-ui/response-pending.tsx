"use client";

import { useEffect, useState } from "react";

/** Mounted only while the last assistant message is empty and running. */
export function ResponsePending({
  creating,
  stopping,
}: {
  creating: boolean;
  stopping: boolean;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="aui-assistant-loading-dot-wrapper text-aomi-muted flex min-h-6 flex-wrap items-center gap-2 px-1 text-xs"
    >
      <span className="aui-assistant-loading-dot bg-aomi-fg block size-2.5 animate-pulse rounded-full" />
      <span>
        {stopping
          ? "Stopping response…"
          : creating
            ? "Creating chat…"
            : "Starting response…"}
      </span>
      {slow && (
        <span>
          {stopping
            ? "Still waiting for the server to confirm Stop."
            : "This is taking a little longer. You can stop the request."}
        </span>
      )}
    </div>
  );
}
