import type { ProjectDeploymentAttempt } from "@aomi-labs/deploy";
import { LaunchRequestError } from "@aomi-labs/deploy/launch";
export type { ProjectDeploymentAttempt };

export const ATTEMPT_STAGES = [
  "Validate",
  "Queue build",
  "Build",
  "Publish release",
  "Activate",
  "Verify runtime",
  "Live",
] as const;
export type AttemptStageState =
  | "waiting"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export function attemptStages(
  attempt: ProjectDeploymentAttempt,
): Array<{ name: string; state: AttemptStageState }> {
  const jobs = attempt.jobs ?? [];
  const verification = jobs.filter(
    (job) =>
      job.name === "Verify runtime" || job.name.startsWith("Verify runtime / "),
  );
  const failed =
    attempt.conclusion === "failure" || attempt.conclusion === "timed_out";
  return ATTEMPT_STAGES.map((name) => {
    if (name === "Live")
      return {
        name,
        state:
          verification.length > 0 &&
          verification.every((job) => job.conclusion === "success")
            ? "passed"
            : "waiting",
      };
    if (name === "Queue build") {
      const build = jobs.find(
        (job) => job.name === "Build" || job.name.startsWith("Build / "),
      );
      return {
        name,
        state:
          build && build.status !== "queued"
            ? "passed"
            : build?.status === "queued" || attempt.status === "queued"
              ? "running"
              : "waiting",
      };
    }
    const matching = jobs.filter(
      (job) => job.name === name || job.name.startsWith(`${name} / `),
    );
    if (!matching.length)
      return {
        name,
        state:
          name === "Validate" && !jobs.length
            ? failed
              ? "failed"
              : attempt.status === "in_progress"
                ? "running"
                : "waiting"
            : "waiting",
      };
    const reused = (job: (typeof matching)[number]) =>
      job.steps.some(
        (step) =>
          step.name === "Reuse verified release" &&
          step.conclusion === "success",
      );
    const state: AttemptStageState = matching.some((job) =>
      ["failure", "timed_out"].includes(job.conclusion ?? ""),
    )
      ? "failed"
      : matching.some((job) => job.status === "in_progress")
        ? "running"
        : matching.every(
              (job) =>
                job.conclusion === "skipped" ||
                job.conclusion === "cancelled" ||
                reused(job),
            )
          ? "skipped"
          : matching.every((job) => job.conclusion === "success")
            ? "passed"
            : "waiting";
    return { name, state };
  });
}

export function attemptLabel(attempt: ProjectDeploymentAttempt): string {
  if (attempt.status === "cancelling") return "Cancelling…";
  if (attempt.conclusion === "cancelled") return "Cancelled";
  const stages = attemptStages(attempt);
  if (stages.at(-1)?.state === "passed") return "Live";
  const failed = stages.find((stage) => stage.state === "failed");
  if (failed) return `${failed.name} failed`;
  if (attempt.status === "completed")
    return attempt.conclusion === "success"
      ? "Build ready"
      : "Deployment failed";
  return stages.find((stage) => stage.state === "running")?.name ?? "Queued";
}

export async function attemptRequest<T>(
  projectId: number,
  options: {
    runId?: number;
    page?: number;
    action?: "start" | "cancel";
    branch?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { signal, ...input } = options;
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (input.runId) params.set("runId", String(input.runId));
  if (input.page) params.set("page", String(input.page));
  const response = await fetch(
    `/api/bff/launch/attempts?${params}`,
    input.action
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, ...input }),
          signal,
        }
      : { signal },
  );
  const body = await response.json();
  if (!response.ok)
    throw new LaunchRequestError(
      typeof body.error === "string" ? body.error : "Deployment request failed",
      response.status,
      body,
    );
  return body;
}
