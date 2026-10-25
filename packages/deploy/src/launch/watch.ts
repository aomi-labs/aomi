// =============================================================================
// Deployment watch loop — polling with backoff, behind the browser client's
// `createLaunchClient().watch`.
//
// Browser-safe: no fetch, no env, no transport. It takes a `poll` closure so
// the caller supplies its own request and its own "this error is fatal" rule.
// =============================================================================

import type {
  DeploymentProgressEvent,
  DeploymentStatus,
  ProgressModel,
  WatchDeploymentOptions,
} from "../types";

const TOTAL_STEPS = 8;

/** Where a deployment sits in the 8-step build → release arc. */
export function deploymentProgress(
  status: DeploymentStatus,
  lastCompleted: number,
): ProgressModel {
  const total = TOTAL_STEPS;
  switch (status.state) {
    case "pending":
      return { completed: 1, total, label: "Waiting for build" };
    case "building":
      return { completed: 2, total, label: "Building CI" };
    case "releasing":
      return { completed: 5, total, label: "Verifying release assets" };
    case "ready":
      return { completed: 8, total, label: "Build ready" };
    case "no_ci":
      return { completed: lastCompleted, total, label: "No CI" };
    case "failed":
      return { completed: lastCompleted, total, label: "Build failed" };
    default:
      return { completed: lastCompleted, total, label: "Waiting for build" };
  }
}

export function backoffDelay(
  failures: number,
  baseMs: number,
  maxMs: number,
): number {
  return Math.min(baseMs * Math.pow(2, failures), maxMs);
}

/** A deployment stops moving in exactly these states. */
export function isTerminalState(status: DeploymentStatus): boolean {
  return (
    status.state === "ready" ||
    status.state === "failed" ||
    status.state === "no_ci"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failedStatus(message: string): DeploymentStatus {
  return { state: "failed", deployment: null, releaseTags: [], apps: [], ci: null, message };
}

export type WatchLoopOptions = WatchDeploymentOptions & {
  /**
   * Whether an error means "stop now" rather than "retry". Transports differ
   * (`BackendError` server-side, `LaunchRequestError` in the browser), so the
   * caller decides; the default retries everything until `maxRetries`.
   */
  isFatal?: (error: unknown) => boolean;
};

/**
 * Poll `poll()` until the deployment reaches a terminal state or retries are
 * exhausted, calling `onEvent` on every tick.
 *
 * It never throws and never rejects: a failure is delivered as an `error`
 * event, so a UI render loop has exactly one code path to handle. `completed`
 * is monotonic — progress never visibly goes backwards on a flapping poll.
 */
export async function watchDeploymentLoop(
  poll: () => Promise<DeploymentStatus>,
  onEvent: (event: DeploymentProgressEvent) => void,
  options: WatchLoopOptions = {},
): Promise<void> {
  const baseDelayMs = options.baseDelayMs ?? 3000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const maxRetries = options.maxRetries ?? 8;
  const signal = options.signal;
  const isFatal = options.isFatal ?? (() => false);

  let failures = 0;
  let lastCompleted = 0;
  let lastProgress: ProgressModel = {
    completed: 0,
    total: TOTAL_STEPS,
    label: "Waiting for build",
  };

  while (!signal?.aborted && failures < maxRetries) {
    try {
      const status = await poll();
      const mapped = deploymentProgress(status, lastCompleted);
      const completed = Math.max(mapped.completed, lastCompleted);
      const progress: ProgressModel = { ...mapped, completed };
      lastCompleted = completed;
      lastProgress = progress;

      const terminal = isTerminalState(status);
      onEvent({ kind: terminal ? "terminal" : "progress", status, progress });
      if (terminal) return;

      failures = 0;
      await sleep(backoffDelay(0, baseDelayMs, maxDelayMs));
    } catch (err) {
      if (isFatal(err)) {
        const error = err instanceof Error ? err : new Error(String(err));
        onEvent({
          kind: "error",
          status: failedStatus(error.message),
          progress: lastProgress,
          error,
        });
        return;
      }
      failures++;
      const error = err instanceof Error ? err : new Error(String(err));
      onEvent({
        kind: "warning",
        status: failedStatus(
          `Polling attempt failed (${failures}/${maxRetries}): ${error.message}`,
        ),
        progress: lastProgress,
        error,
      });
      await sleep(backoffDelay(failures, baseDelayMs, maxDelayMs));
    }
  }

  const message = signal?.aborted
    ? "Watch cancelled"
    : `Polling stopped after ${maxRetries} consecutive failures`;
  onEvent({
    kind: "error",
    status: failedStatus(message),
    progress: lastProgress,
    error: new Error(message),
  });
}

export type DeploymentReadyWatchOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (status: DeploymentStatus) => void;
  isFatal?: (error: unknown) => boolean;
};

/**
 * Poll a deployment until CI publishes its release. Successful status reads
 * are reported to the caller; transient reads stay inside one deadline so each
 * UI does not need to maintain its own retry/timeout loop.
 */
export async function waitForDeploymentReady(
  poll: () => Promise<DeploymentStatus>,
  options: DeploymentReadyWatchOptions = {},
): Promise<DeploymentStatus> {
  const intervalMs = options.intervalMs ?? 4000;
  const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    if (options.signal?.aborted) throw abortError();
    let status: DeploymentStatus | null = null;
    try {
      status = await poll();
    } catch (error) {
      lastError = error;
      if (options.isFatal?.(error)) throw error;
    }

    if (status) {
      if (status.state === "failed" || status.state === "no_ci") {
        throw new Error(
          status.message ??
            (status.state === "no_ci"
              ? "No CI ran for this deployment."
              : "Deploy CI failed."),
        );
      }
      options.onProgress?.(status);
      if (status.state === "ready") return status;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw timeoutError(
        "Timed out waiting for the deployment to become ready.",
        lastError,
      );
    }
    await sleepWithAbort(Math.min(intervalMs, remaining), options.signal);
  }
}

export type AppRuntimeExpectation = {
  name: string;
  releaseTag?: string;
};

export type AppRuntimeSnapshotApp = {
  id?: number;
  name: string;
  app_release_tag?: string | null;
  is_active: boolean;
  loaded: boolean;
};

export type AppRuntimeSnapshot = {
  apps: readonly AppRuntimeSnapshotApp[];
};

export type AppRuntimeWatchProgress = {
  attempt: number;
  ready: number;
  total: number;
  snapshot: AppRuntimeSnapshot;
  /** Present when this attempt could not read a runtime snapshot. */
  error?: unknown;
};

export type AppRuntimeWatchOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AppRuntimeWatchProgress) => void;
  isFatal?: (error: unknown) => boolean;
};

function runtimeAppMatches(
  app: AppRuntimeSnapshotApp,
  expected: AppRuntimeExpectation,
): boolean {
  return (
    app.name === expected.name &&
    (!expected.releaseTag || app.app_release_tag === expected.releaseTag) &&
    app.is_active &&
    app.loaded
  );
}

export function runtimeAppsReady(
  snapshot: AppRuntimeSnapshot,
  expected: readonly AppRuntimeExpectation[],
): boolean {
  return (
    expected.length > 0 &&
    expected.every((target) =>
      snapshot.apps.some((app) => runtimeAppMatches(app, target)),
    )
  );
}

function runtimeReadyCount(
  snapshot: AppRuntimeSnapshot,
  expected: readonly AppRuntimeExpectation[],
): number {
  return expected.filter((target) =>
    snapshot.apps.some((app) => runtimeAppMatches(app, target)),
  ).length;
}

function abortError(): Error {
  const error = new Error("Runtime watch cancelled");
  error.name = "AbortError";
  return error;
}

function timeoutError(message: string, lastError: unknown): Error {
  if (lastError === undefined) return new Error(message);
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  return new Error(`${message} Last error: ${detail}`);
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll a project-scoped runtime snapshot until every expected release is live.
 * Transient read failures stay inside the same deadline, while callers can
 * rethrow permanent errors through `isFatal`; navigation or reset can cancel
 * the loop through the supplied AbortSignal.
 */
export async function waitForAppsToLoad(
  poll: () => Promise<AppRuntimeSnapshot>,
  expected: readonly AppRuntimeExpectation[],
  options: AppRuntimeWatchOptions = {},
): Promise<AppRuntimeSnapshot> {
  const intervalMs = options.intervalMs ?? 4000;
  const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown;
  let lastSnapshot: AppRuntimeSnapshot = { apps: [] };

  for (;;) {
    if (options.signal?.aborted) throw abortError();
    attempt += 1;
    try {
      const snapshot = await poll();
      lastSnapshot = snapshot;
      options.onProgress?.({
        attempt,
        ready: runtimeReadyCount(snapshot, expected),
        total: expected.length,
        snapshot,
      });
      if (runtimeAppsReady(snapshot, expected)) return snapshot;
    } catch (error) {
      lastError = error;
      if (options.isFatal?.(error)) throw error;
      options.onProgress?.({
        attempt,
        ready: runtimeReadyCount(lastSnapshot, expected),
        total: expected.length,
        snapshot: lastSnapshot,
        error,
      });
      // Keep transient ownership/runtime reads inside the same deadline.
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw timeoutError(
        `Timed out waiting for ${expected.map((app) => app.name).join(", ")} to load in this runtime.`,
        lastError,
      );
    }
    await sleepWithAbort(Math.min(intervalMs, remaining), options.signal);
  }
}
