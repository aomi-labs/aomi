"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { DeployFlowState } from "@build/features/launch/hooks/use-project-detail";

/**
 * The redeploy pipeline's progress bar. `deployFlow.message` alone left the
 * user staring at one unchanging line for the whole CI build with no sense of
 * where in the pipeline they were or whether anything was still moving; the
 * bar, the elapsed clock, and the CI link answer all three.
 */
export function DeployProgressBar({
  deployFlow,
  startedAt,
}: {
  deployFlow: DeployFlowState;
  /** Epoch ms of the current deploy, for the elapsed clock. */
  startedAt: number | null;
}) {
  if (deployFlow.phase === "idle") return null;

  const failed = deployFlow.phase === "error";
  const complete = deployFlow.phase === "done";
  const progress = "progress" in deployFlow ? deployFlow.progress : undefined;
  // A phase with no progress yet still gets a visible sliver, so the bar never
  // renders as an empty track while work is plainly in flight.
  const percent = failed ? 100 : (progress?.percent ?? 2);
  const ciUrl = progress?.ciUrl ?? null;

  return (
    <div className="border-border border-b px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span
          className={
            failed
              ? "text-destructive font-medium"
              : "text-foreground font-medium"
          }
        >
          {deployFlow.message}
        </span>
        <span className="text-dim flex shrink-0 items-center gap-2 font-mono text-[10px]">
          {startedAt !== null && !complete && !failed && (
            <Elapsed startedAt={startedAt} />
          )}
          {ciUrl && (
            <a
              href={ciUrl}
              target="_blank"
              rel="noreferrer"
              className="text-dim hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
            >
              CI run
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          {!failed && <span>{percent}%</span>}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Deployment progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={failed ? undefined : percent}
        aria-valuetext={progress?.label ?? deployFlow.message}
        className="bg-surface-1 border-border mt-1.5 h-1.5 w-full overflow-hidden rounded-full border"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            failed
              ? "bg-destructive"
              : complete
                ? "bg-positive"
                : "bg-primary animate-pulse"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** mm:ss since the deploy started. Purely cosmetic; ticks once a second. */
function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return <span aria-label="Elapsed">{`${mm}:${ss}`}</span>;
}
