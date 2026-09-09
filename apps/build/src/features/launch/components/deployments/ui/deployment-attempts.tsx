"use client";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import {
  attemptLabel,
  attemptStages,
  type ProjectDeploymentAttempt,
} from "@build/features/launch/attempts";
import type { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";

type Detail = ReturnType<typeof useProjectDetail>;
const button =
  "border-border hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:opacity-50";

export function AttemptControls({
  detail,
  blocked,
}: {
  detail: Detail;
  blocked: boolean;
}) {
  const [branch, setBranch] = useState("");
  // Follow the latest attempt's branch until the user types; a poll must not
  // overwrite what they are entering.
  const [dirty, setDirty] = useState(false);
  const latest = detail.attempts.attempts[0];
  useEffect(() => {
    if (!dirty) setBranch(latest?.branch ?? "");
  }, [dirty, latest?.branch]);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="text-dim flex items-center gap-2 text-xs">
        Branch
        <input
          aria-label="Deployment branch"
          placeholder="Repository default"
          maxLength={120}
          value={branch}
          onChange={(event) => {
            setDirty(true);
            setBranch(event.target.value);
          }}
          disabled={detail.attempts.busy}
          className="border-border bg-background text-foreground h-9 w-40 rounded-md border px-2"
        />
      </label>
      <button
        className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-xs font-medium disabled:opacity-50"
        disabled={blocked || detail.attempts.busy || !detail.attempts.isSuccess}
        onClick={() => void detail.redeploySource(branch)}
      >
        {detail.attempts.busy
          ? "Deployment running…"
          : latest?.conclusion && latest.conclusion !== "success"
            ? "Retry deployment"
            : "Deploy"}
      </button>
    </div>
  );
}

export function DeploymentAttempts({ detail }: { detail: Detail }) {
  const { attempts } = detail;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const latestId = attempts.attempts[0]?.id;
  useEffect(() => {
    setExpanded(latestId ?? null);
  }, [latestId]);

  return (
    <div className="divide-border divide-y" aria-label="Deployment attempts">
      {(attempts.isError || attempts.failureCount > 0) && (
        <div role="status" className="bg-amber-500/5 px-4 py-3 text-sm">
          {attempts.isFetching
            ? "Reconnecting… Last known deployment progress is shown below."
            : "Status unavailable. Your deployment may still be running."}
          <button
            className={`${button} ml-3`}
            onClick={() => void attempts.refetch()}
          >
            Reconnect
          </button>
        </div>
      )}
      {attempts.mutationError && (
        <p role="alert" className="text-destructive px-4 py-3 text-sm">
          {attempts.mutationError}
        </p>
      )}
      {attempts.mutationNotice && (
        <p role="status" className="text-dim px-4 py-3 text-sm">
          {attempts.mutationNotice}
        </p>
      )}
      {attempts.local.map((local) => (
        <section key={local.id} className="px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <strong
              className={local.pending ? "text-sm" : "text-destructive text-sm"}
            >
              {local.pending ? "Validate" : "Couldn’t start deployment"}
            </strong>
            <time className="text-dim text-xs">
              {new Date(local.createdAt).toLocaleString()}
            </time>
          </div>
          <p
            className="text-dim mt-2 whitespace-pre-wrap text-sm"
            role={local.pending ? "status" : "alert"}
          >
            {local.message}
          </p>
          <p className="text-dim mt-1 text-xs">
            {local.branch || "Repository default branch"} ·{" "}
            {local.pending
              ? "Resolving and validating the latest commit"
              : "Saved in this browser; no CI run has been confirmed here"}
          </p>
          {!local.pending && (
            <div className="mt-3 flex gap-2">
              <button
                className={button}
                disabled={attempts.busy || attempts.isError}
                onClick={() => void detail.redeploySource(local.branch)}
              >
                <RotateCcw className="size-3" />
                Retry deployment
              </button>
              <button
                className={button}
                onClick={() => attempts.clearLocal(local.id)}
              >
                Dismiss
              </button>
            </div>
          )}
        </section>
      ))}
      {attempts.attempts.map((attempt) => (
        <AttemptCard
          key={attempt.id}
          attempt={attempt}
          detail={detail}
          expanded={expanded === attempt.id}
          onExpand={() => {
            setExpanded(expanded === attempt.id ? null : attempt.id);
            if (!attempt.jobs) void attempts.loadDetail(attempt.id);
          }}
          now={now}
        />
      ))}
      {attempts.isPending && !attempts.local.length && (
        <p className="text-dim px-4 py-4 text-sm" role="status">
          Loading deployment attempts…
        </p>
      )}
      {attempts.hasNextPage && (
        <div className="px-4 py-3">
          <button
            className={button}
            disabled={attempts.isFetchingNextPage}
            onClick={() => void attempts.fetchNextPage()}
          >
            {attempts.isFetchingNextPage ? "Loading…" : "Load older attempts"}
          </button>
        </div>
      )}
      {!!attempts.attempts.length && (
        <p className="text-dim px-4 py-2 text-xs">
          Attempt history and CI logs follow GitHub retention. Full logs require
          repository access.
        </p>
      )}
    </div>
  );
}

function AttemptCard({
  attempt,
  detail,
  expanded,
  onExpand,
  now,
}: {
  attempt: ProjectDeploymentAttempt;
  detail: Detail;
  expanded: boolean;
  onExpand: () => void;
  now: number;
}) {
  const stages = attemptStages(attempt);
  const failed =
    attempt.conclusion === "failure" || attempt.conclusion === "timed_out";
  const running = attempt.status !== "completed";
  const activating = attempt.jobs?.some(
    (job) =>
      job.name === "Activate" &&
      job.conclusion !== "skipped" &&
      !!job.startedAt &&
      job.status !== "queued",
  );
  const label =
    detail.attempts.cancelling === attempt.id
      ? "Cancelling…"
      : attemptLabel(attempt);
  const finished = running
    ? now
    : Date.parse(attempt.updatedAt ?? attempt.createdAt);
  const elapsed = Math.max(
    0,
    Math.floor((finished - Date.parse(attempt.createdAt)) / 1000),
  );
  const duration = (stage: string) => {
    const jobs = (attempt.jobs ?? []).filter(
      (job) => job.name === stage || job.name.startsWith(`${stage} / `),
    );
    const starts = jobs
      .flatMap((job) => (job.startedAt ? [Date.parse(job.startedAt)] : []))
      .filter(Number.isFinite);
    if (!starts.length) return null;
    const ends = jobs
      .map((job) => (job.completedAt ? Date.parse(job.completedAt) : now))
      .filter(Number.isFinite);
    const seconds = Math.max(
      0,
      Math.round((Math.max(...ends) - Math.min(...starts)) / 1000),
    );
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  const failedJob = attempt.jobs?.find(
    (job) => job.conclusion === "failure" || job.conclusion === "timed_out",
  );
  return (
    <section className="px-4 py-4" aria-label={`Deployment ${attempt.id}`}>
      <button
        onClick={onExpand}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        {failed ? (
          <AlertCircle className="text-destructive size-4" />
        ) : running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        <strong className={`text-sm ${failed ? "text-destructive" : ""}`}>
          {label}
        </strong>
        <span className="text-dim ml-auto text-xs">
          {Math.floor(elapsed / 60)}m {elapsed % 60}s
        </span>
        <ChevronDown className={`size-4 ${expanded ? "rotate-180" : ""}`} />
      </button>
      <p className="text-dim mt-2 text-xs">
        Attempt {attempt.number ?? attempt.id}
        {attempt.previousRunId
          ? ` · Follows attempt ${attempt.previousRunId}`
          : ""}{" "}
        · {attempt.branch || "Pinned commit"} ·{" "}
        <code>{attempt.commit?.slice(0, 12)}</code> ·{" "}
        {new Date(attempt.createdAt).toLocaleString()}
      </p>
      {expanded && (
        <div className="mt-4 space-y-4">
          <ol
            className="grid gap-2 sm:grid-cols-2"
            aria-label="Deployment stages"
          >
            {stages.map((stage) => (
              <li
                key={stage.name}
                className={`flex items-center justify-between rounded border px-3 py-2 text-xs ${stage.state === "failed" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border"}`}
              >
                <span>
                  {stage.name}
                  {duration(stage.name) && (
                    <span className="text-dim ml-2">
                      {duration(stage.name)}
                    </span>
                  )}
                </span>
                <span>
                  {stage.state === "waiting"
                    ? "Not started"
                    : stage.state === "running"
                      ? "Running…"
                      : stage.state === "passed"
                        ? "Passed"
                        : stage.state === "skipped"
                          ? "Skipped"
                          : "Failed"}
                </span>
              </li>
            ))}
          </ol>
          {attempt.jobs?.some((job) => job.name.includes(" / ")) && (
            <ul className="space-y-1" aria-label="App progress">
              {attempt.jobs
                .filter((job) => job.name.includes(" / "))
                .map((job) => (
                  <li key={job.id} className="flex justify-between text-xs">
                    <span>{job.name}</span>
                    <span>
                      {job.steps.some(
                        (step) =>
                          step.name === "Reuse verified release" &&
                          step.conclusion === "success",
                      )
                        ? "Release reused"
                        : (job.conclusion ?? job.status.replaceAll("_", " "))}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {failedJob && (
            <p className="text-destructive text-sm">
              {failedJob.name}:{" "}
              {failedJob.steps.find((step) => step.conclusion === "failure")
                ?.name ?? "Job failed"}
            </p>
          )}
          {attempt.diagnostics?.map((message, index) => (
            <pre
              key={index}
              className="bg-surface-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs"
            >
              {message}
            </pre>
          ))}
          {failed && !attempt.diagnostics?.length && (
            <p className="text-dim text-xs">
              No diagnostic excerpt was supplied by CI. Open the full logs for
              details.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(failed || attempt.conclusion === "cancelled") && (
              <button
                className={button}
                disabled={detail.attempts.busy || !detail.attempts.isSuccess}
                onClick={() => void detail.redeploySource(attempt.branch)}
              >
                <RotateCcw className="size-3" />
                Retry deployment
              </button>
            )}
            {running && !activating && (
              <button
                className={button}
                disabled={detail.attempts.cancelling === attempt.id}
                onClick={() => void detail.attempts.cancel(attempt.id)}
              >
                <X className="size-3" />
                Cancel deployment
              </button>
            )}
            {attempt.url && (
              <a
                className={button}
                href={attempt.url}
                title="GitHub repository access is required"
                target="_blank"
                rel="noreferrer"
              >
                View full CI logs
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          {failed && (
            <p className="text-dim text-xs">
              Retry checks the latest commit on{" "}
              {attempt.branch || "the repository default branch"}. An existing
              successful release can be reused.
            </p>
          )}
          <p className="text-dim text-xs">
            Last update:{" "}
            {new Date(
              attempt.updatedAt ?? attempt.createdAt,
            ).toLocaleTimeString()}
            .
          </p>
        </div>
      )}
    </section>
  );
}
