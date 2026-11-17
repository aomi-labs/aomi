import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { RunResult, SmithersEvent } from "smithers-orchestrator";
import type { BuildPlan } from "./plan";
import {
  createRunState,
  defaultRunsRoot,
  loadRunState,
  resetRunState,
  runDir,
  savePlan,
  smitherDbPath,
} from "./state";
import {
  buildPackageWorkflow,
  createAomiSmither,
  describeBackend,
  type AomiSmitherApi,
  type SmitherBackend,
  type WorkflowDeps,
} from "./workflow";

export function isBunRuntime(): boolean {
  // Check Bun.version rather than the bare global: Node hosts (the aomi-build
  // BFF) polyfill a minimal `Bun` for the engine's unguarded Bun.sleep calls,
  // and that polyfill deliberately omits `version`.
  const bun = (globalThis as { Bun?: { version?: unknown } }).Bun;
  return typeof bun?.version === "string";
}

/** Bun-only surfaces (the gateway console bundles its UI with Bun.build). */
export function assertBunRuntime(): void {
  if (!isBunRuntime()) {
    throw new Error(
      "This aomi-smither surface needs Bun (https://bun.sh) — the gateway console bundles with Bun.build. Workflow runs themselves also work on Node via the pglite/postgres backends.",
    );
  }
}

/**
 * Pick where run state lives. An explicit SMITHER_DATABASE_URL wins on any
 * runtime (shared/durable Postgres); otherwise Bun keeps the classic
 * bun:sqlite file and Node falls back to an embedded PGlite dir beside it.
 */
export function resolveRunBackend(
  packageName: string,
  options: { runsRoot?: string; env?: NodeJS.ProcessEnv } = {},
): SmitherBackend {
  const env = options.env ?? process.env;
  const runsRoot = options.runsRoot ?? defaultRunsRoot;
  const connectionString = env.SMITHER_DATABASE_URL;
  if (connectionString) {
    return { kind: "postgres", connectionString };
  }
  if (isBunRuntime()) {
    return { kind: "sqlite", dbPath: smitherDbPath(packageName, runsRoot) };
  }
  return {
    kind: "pglite",
    dataDir: path.join(runDir(packageName, runsRoot), "pglite"),
  };
}

export type PreparedRun = {
  api: AomiSmitherApi;
  workflow: Awaited<ReturnType<typeof buildPackageWorkflow>>;
  plan: BuildPlan;
  runId: string;
  /** True when a prior run exists for this package and we're continuing it. */
  resume: boolean;
  backend: SmitherBackend;
  /** Human-readable state location (sqlite path, pglite dir, or "postgres"). */
  stateLocation: string;
};

export async function prepareRun(options: {
  plan: BuildPlan;
  deps?: WorkflowDeps;
  runsRoot?: string;
  overwrite?: boolean;
  backend?: SmitherBackend;
  /** Reuse an already-open store handle (one per backend per process — the
   *  embedded PGlite backend cannot be opened twice on one dataDir). */
  api?: AomiSmitherApi;
  /** Use a caller-allocated run id when creating fresh state (a control
   *  plane that pre-registers the run before dispatching a runner). An
   *  existing run for the package still resumes under its own id. */
  runId?: string;
}): Promise<PreparedRun> {
  const runsRoot = options.runsRoot ?? defaultRunsRoot;
  const packageName = options.plan.packageName;
  if (options.overwrite) {
    await resetRunState(packageName, runsRoot);
  }
  await mkdir(runDir(packageName, runsRoot), { recursive: true });
  await savePlan(options.plan, runsRoot);
  const existing = await loadRunState(packageName, runsRoot);
  const backend =
    options.backend ?? resolveRunBackend(packageName, { runsRoot });
  const api = options.api ?? (await createAomiSmither(backend));
  // run.json is only a local pointer; the run itself lives in the backend.
  // A pointer whose run the store doesn't know (fresh/shared Postgres, wiped
  // sqlite, another instance's leftover) must start fresh, not resume — the
  // engine hard-fails resuming a run id that has no rows.
  const resumable =
    existing !== null && (await storeHasRun(api, existing.runId));
  const state = resumable
    ? existing
    : await createRunState(packageName, runsRoot, options.runId);
  const workflow = await buildPackageWorkflow(api, options.plan, options.deps);
  return {
    api,
    workflow,
    plan: options.plan,
    runId: state.runId,
    resume: resumable,
    backend,
    stateLocation: describeBackend(backend),
  };
}

/** Whether the durable store has any rows for this run id. */
async function storeHasRun(
  api: AomiSmitherApi,
  runId: string,
): Promise<boolean> {
  const { SmithersDb } = await import("smithers-orchestrator");
  const adapter = new SmithersDb(api.db as never);
  return (await adapter.getRun(runId)) != null;
}

export async function executeRun(
  prepared: PreparedRun,
  options: {
    onEvent?: (event: SmithersEvent) => void;
    signal?: AbortSignal;
    maxConcurrency?: number;
  } = {},
): Promise<RunResult> {
  const { runWorkflow } = await import("smithers-orchestrator");
  return Effect.runPromise(
    runWorkflow(prepared.workflow, {
      input: prepared.plan,
      runId: prepared.runId,
      resume: prepared.resume,
      rootDir: prepared.plan.sdkRoot,
      maxConcurrency: options.maxConcurrency,
      onProgress: options.onEvent,
      signal: options.signal,
      // The composed graph mounts phase N only after phase N-1's output row is
      // visible to a re-render. On async backends (pglite/postgres) the run
      // must not settle between a task finishing and that re-render, or it
      // ends "finished" with unmounted phases still ahead.
      requireRerenderOnOutputChange: true,
      // The result row embeds the crate artifact (artifacts.ts); the engine's
      // 200 KB default would reject it for any non-trivial package.
      maxOutputBytes: 4_000_000,
    }),
  );
}

/** Statuses where the run is parked on something external and re-executing
 *  with resume is the way forward once that thing arrives: a durable approval
 *  decision (`waiting-approval`) or an external signal (`waiting-event`).
 *  smithers 0.28 adds `paused` (graceful pause via RunOptions.pauseSignal) —
 *  deliberately not parked here: we never pass pauseSignal, and a paused run
 *  should settle back to its caller, not spin this loop. */
const PARKED_STATUSES = new Set(["waiting-approval", "waiting-event"]);

/**
 * Run to a terminal status. `runWorkflow` RETURNS a parked status when the only
 * pending work is a human decision or an external signal — it does not block on
 * it. Those unblock via durable writes from any surface (TUI, browser console,
 * `sendSignal`), so this loop re-executes with resume until the run settles:
 * completed nodes replay from cache, decided/signaled nodes advance, and a
 * still-parked run cheaply returns to waiting.
 */
export async function executeRunUntilSettled(
  prepared: PreparedRun,
  options: {
    onEvent?: (event: SmithersEvent) => void;
    signal?: AbortSignal;
    maxConcurrency?: number;
    /** How often to re-check while parked. @default 2500 */
    approvalPollMs?: number;
  } = {},
): Promise<RunResult> {
  let attempt = prepared;
  for (;;) {
    const result = await executeRun(attempt, options);
    if (!PARKED_STATUSES.has(result.status) || options.signal?.aborted) {
      return result;
    }
    attempt = { ...attempt, resume: true };
    await new Promise((wake) =>
      setTimeout(wake, options.approvalPollMs ?? 2500),
    );
  }
}

/**
 * Narrow raw-SQL door into the run store, for host-package tables that must live
 * on the same connection (the embedded PGlite backend cannot be opened twice
 * in one process). Statements use `?` placeholders on every backend — the
 * storage layer translates for Postgres. Rows come back with on-disk column
 * names (no snake→camel transform).
 */
export async function storeQuery(
  api: AomiSmitherApi,
  sql: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const { SmithersDb } = await import("smithers-orchestrator");
  const adapter = new SmithersDb(api.db as never) as unknown as {
    internalStorage: {
      queryAllRaw(
        sql: string,
        params?: unknown[],
      ): Promise<Array<Record<string, unknown>>>;
    };
  };
  return adapter.internalStorage.queryAllRaw(sql, params);
}

/**
 * All persisted output rows for a run, keyed by table name ("curation",
 * "result", …). Lets surfaces outside the workflow render (the web BFF, the
 * console) read what a run produced — including replayed resumes that emit no
 * live node events.
 */
export async function loadRunOutputs(
  api: AomiSmitherApi,
  runId: string,
): Promise<Record<string, ReadonlyArray<Record<string, unknown>>>> {
  const { loadOutputs } = await import("smithers-orchestrator");
  const outputs = await loadOutputs(
    api.db as never,
    api.tables as never,
    runId,
  );
  return outputs as Record<string, ReadonlyArray<Record<string, unknown>>>;
}

export type RunNodeView = {
  nodeId: string;
  /** Scheduler task state: pending/running/finished/failed/skipped/waiting-*. */
  state: string;
  iteration: number;
  updatedAtMs: number;
};

export type RunView = {
  /** Run status from the store, or null when the run id is unknown. */
  status: string | null;
  error?: string;
  /** Latest state per node id (highest iteration wins). */
  nodes: RunNodeView[];
  outputs: Record<string, ReadonlyArray<Record<string, unknown>>>;
};

/**
 * Reconstruct a run's observable state purely from the durable store — no
 * live event stream, no render ctx. This is what makes any process (another
 * web instance, an observer console) able to serve a run it never executed.
 */
export async function readRunView(
  api: AomiSmitherApi,
  runId: string,
): Promise<RunView> {
  const { SmithersDb } = await import("smithers-orchestrator");
  const adapter = new SmithersDb(api.db as never);
  // Adapter reads are RunnableEffects — PromiseLike, so await works directly.
  const [run, nodeRows, outputs] = await Promise.all([
    adapter.getRun(runId),
    adapter.listNodes(runId),
    loadRunOutputs(api, runId),
  ]);
  const latest = new Map<string, RunNodeView>();
  for (const row of nodeRows ?? []) {
    const prev = latest.get(row.nodeId);
    if (!prev || row.iteration >= prev.iteration) {
      latest.set(row.nodeId, {
        nodeId: row.nodeId,
        state: row.state,
        iteration: row.iteration,
        updatedAtMs: row.updatedAtMs,
      });
    }
  }
  let error: string | undefined;
  if (run?.errorJson) {
    try {
      const parsed = JSON.parse(run.errorJson) as { message?: string };
      error = parsed.message ?? run.errorJson;
    } catch {
      error = run.errorJson;
    }
  }
  return {
    status: run?.status ?? null,
    ...(error ? { error } : {}),
    nodes: [...latest.values()],
    outputs,
  };
}

/**
 * Ask the engine to cancel a run via the durable store. The executing process
 * (this one or another — the engine polls `cancel_requested_at_ms`) winds the
 * run down to a `cancelled` terminal status. Safe to call from any surface
 * with store access.
 */
export async function requestRunCancel(
  api: AomiSmitherApi,
  runId: string,
): Promise<void> {
  const { SmithersDb } = await import("smithers-orchestrator");
  const adapter = new SmithersDb(api.db as never);
  await adapter.requestRunCancel(runId, Date.now());
}

/**
 * Deliver an external signal that resolves a `wait-external` pause (a Smithers
 * `<Signal>` node keyed by the phase's node id). The durable write is picked up
 * by the next resume; call from the CLI `signal` subcommand, the console
 * `/signal` endpoint, or any external system with access to the run's SQLite.
 */
export async function sendSignal(options: {
  api: AomiSmitherApi;
  runId: string;
  nodeId: string;
  ready?: boolean;
  note?: string;
  receivedBy?: string;
}): Promise<void> {
  const { SmithersDb, signalRun } = await import("smithers-orchestrator");
  const adapter = new SmithersDb(options.api.db as never);
  await Effect.runPromise(
    signalRun(adapter, options.runId, options.nodeId, {
      ready: options.ready ?? true,
      note: options.note ?? "",
      receivedBy: options.receivedBy ?? "aomi-smither",
    }),
  );
}

/** Write a durable approval decision for a paused node (deploy gate, a
 *  needsApproval task, or a select-mode clarify). The in-process engine picks
 *  it up on its next frame. For clarifies pass `selection` — it becomes the
 *  `{selected, notes}` decision row later phases read as context. */
export async function decideApproval(options: {
  api: AomiSmitherApi;
  runId: string;
  nodeId: string;
  iteration: number;
  approve: boolean;
  note?: string;
  decidedBy?: string;
  selection?: { selected: string; notes?: string };
}): Promise<void> {
  const { SmithersDb, approveNode, denyNode } =
    await import("smithers-orchestrator");
  const adapter = new SmithersDb(options.api.db as never);
  const decide = options.approve ? approveNode : denyNode;
  await Effect.runPromise(
    decide(
      adapter,
      options.runId,
      options.nodeId,
      options.iteration,
      options.note,
      options.decidedBy ?? "aomi-smither",
      options.selection
        ? {
            selected: options.selection.selected,
            notes: options.selection.notes ?? null,
          }
        : undefined,
    ),
  );
}
