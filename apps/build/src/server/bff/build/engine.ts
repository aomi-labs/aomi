import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import type { FailureInput } from "@aomi-labs/observability";
import {
  crateFileTree,
  createAomiSmither,
  decideApproval,
  defaultSdkRoot,
  executeRunUntilSettled,
  finalizePlan,
  prepareRun,
  readRunView,
  requestRunCancel,
  resolveRunBackend,
  sanitizeAppName,
  stageKeyForNode,
  stagesFor,
  type AomiSmitherApi,
  type BuildPlan,
  type PreparedRun,
  type RunView,
} from "@aomi-labs/smither";
import {
  artifactFromOutputs,
  curationFromOutputs,
  resultFromOutputs,
  runStatusFromView,
  stageStatusesFromView,
} from "./run-view";
import {
  findRunById,
  findRunByOwnerApp,
  registerRun,
  updateRun,
  type BuildRunRecord,
} from "./registry";
import { ensureSupervisorInterval } from "./supervisor";
import { mintSidecarBearer, sidecarVerifierPublicKeyPem } from "./sidecar-auth";
import {
  dispatchSandboxRun,
  maybeExtendSandbox,
  sandboxRunnerConfig,
  stopSandbox,
  stopSandboxById,
  type SandboxDispatch,
} from "./sandbox-runner";
import type {
  BuildRunApproval,
  BuildRunFileNode,
  BuildRunSnapshot,
  BuildRunStage,
  BuildRunStageStatus,
  BuildRunStatus,
} from "@/features/build/run-contracts";
import { buildFailures } from "@/server/bff/failures";

function identifyEngineFailure(
  error: unknown,
  operation: string,
  response?: { status: number; error: string },
): FailureInput {
  const context = { routeFamily: "/api/bff/build", operation };
  return {
    source: "local",
    error,
    ...(response ? { response } : {}),
    context,
  };
}

/**
 * In-process aomi-smither engine behind the /build page.
 *
 * Durable run state lives in the backend `resolveRunBackend` picks (postgres
 * via SMITHER_DATABASE_URL, else an embedded PGlite dir per app), so a server
 * restart loses only this in-memory registry, not the run — re-creating the
 * same app resumes it. The registry itself is process-local: on multi-instance
 * deployments, polling must reach the instance that executes the run (pin the
 * BFF to one instance, or move execution into a sandbox provider — v2).
 *
 * Runtime note: smithers-orchestrator ships Bun-flavored TS; on Node the
 * module hooks registered in src/instrumentation.ts make it loadable, and
 * next.config.ts lists these packages in serverExternalPackages so the
 * bundler leaves them to the Node loader.
 */

type EngineEvent = {
  type: string;
  nodeId?: string;
  iteration?: number;
  attempt?: number;
  status?: string;
  error?: unknown;
  request?: { title?: string };
};

type RunHandle = {
  runId: string;
  app: string;
  /** GitHub login that owns this run ("dev" in anonymous local mode). */
  owner: string;
  plan: BuildPlan;
  api: AomiSmitherApi;
  /** Present on handles this process executes; absent on observer handles
   *  reconstructed for runs another process (or a past life) started. */
  prepared?: PreparedRun;
  /** Present when this run executes in a Vercel Sandbox this process booted. */
  dispatch?: SandboxDispatch;
  status: BuildRunStatus;
  stageStatus: Record<string, BuildRunStageStatus>;
  /** HH:MM:SS of each stage's latest live transition. */
  stageTimes: Record<string, string>;
  approvals: BuildRunApproval[];
  lines: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type Registry = {
  byRunId: Map<string, RunHandle>;
  byApp: Map<string, RunHandle>;
  /** One open store handle per app — the embedded PGlite backend cannot be
   *  opened twice on one dataDir in a process. */
  apis: Map<string, Promise<AomiSmitherApi>>;
};

const REGISTRY_KEY = Symbol.for("aomi-build.smither-engine");

function registry(): Registry {
  const holder = globalThis as { [REGISTRY_KEY]?: Registry };
  holder[REGISTRY_KEY] ??= {
    byRunId: new Map(),
    byApp: new Map(),
    apis: new Map(),
  };
  return holder[REGISTRY_KEY];
}

function apiFor(app: string): Promise<AomiSmitherApi> {
  const { apis } = registry();
  let api = apis.get(app);
  if (!api) {
    api = createAomiSmither(resolveRunBackend(app, { runsRoot: runsRoot() }));
    api.catch(() => apis.delete(app));
    apis.set(app, api);
  }
  return api;
}

export class BuildEngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sdkRoot(): string {
  const root = process.env.AOMI_SDK_ROOT ?? defaultSdkRoot();
  if (!existsSync(root)) {
    throw new BuildEngineError(
      `Aomi SDK checkout not found at ${root}. Set AOMI_SDK_ROOT to a local aomi-sdk checkout.`,
      503,
    );
  }
  return root;
}

function runsRoot(): string {
  return (
    process.env.SMITHER_RUNS_ROOT ??
    path.join(process.cwd(), ".smithers", "runs")
  );
}

/** Package-name slug from a free-text prompt, e.g. "Hyperliquid & Binance
 *  arb bot" → "hyperliquid-binance-arb-bot". */
export function appSlugFromPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return slug || "aomi-app";
}

function pushLine(handle: RunHandle, line: string) {
  handle.lines = [...handle.lines.slice(-120), line];
  handle.updatedAt = new Date().toISOString();
}

function nowStamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** Same folding as the TUI's reduceEvent: node events light plan stages,
 *  approval events maintain the pending-approval list. */
function reduceEvent(handle: RunHandle, event: EngineEvent) {
  const setStage = (nodeId: string, status: BuildRunStageStatus) => {
    const key = stageKeyForNode(handle.plan, nodeId);
    // Never let a later loop iteration mark a finished stage pending again.
    if (handle.stageStatus[key] === "complete" && status === "running") return;
    handle.stageStatus[key] = status;
    handle.stageTimes[key] = nowStamp();
  };
  switch (event.type) {
    case "NodeStarted":
      if (event.nodeId) {
        setStage(event.nodeId, "running");
        pushLine(handle, `▸ ${event.nodeId}`);
      }
      break;
    case "NodeFinished":
      if (event.nodeId) {
        setStage(event.nodeId, "complete");
        pushLine(handle, `✓ ${event.nodeId}`);
      }
      break;
    case "NodeFailed": {
      if (!event.nodeId) break;
      setStage(event.nodeId, "failed");
      const message =
        event.error instanceof Error
          ? event.error.message
          : typeof event.error === "string"
            ? event.error
            : JSON.stringify(event.error ?? "failed");
      pushLine(handle, `✗ ${event.nodeId}: ${message.slice(0, 400)}`);
      break;
    }
    case "NodeWaitingApproval": {
      if (!event.nodeId) break;
      setStage(event.nodeId, "waiting");
      const iteration = event.iteration ?? 0;
      if (
        !handle.approvals.some(
          (a) => a.nodeId === event.nodeId && a.iteration === iteration,
        )
      ) {
        handle.approvals.push({ nodeId: event.nodeId, iteration });
        pushLine(handle, `⏸ ${event.nodeId} awaiting approval`);
      }
      // executeRunUntilSettled keeps polling while parked, so the parked
      // status is only visible through events.
      handle.status = "waiting-approval";
      break;
    }
    case "ApprovalRequested": {
      const pending = handle.approvals.find((a) => a.nodeId === event.nodeId);
      if (pending && event.request?.title) pending.title = event.request.title;
      break;
    }
    case "ApprovalGranted":
    case "ApprovalDenied":
      handle.approvals = handle.approvals.filter(
        (a) => a.nodeId !== event.nodeId,
      );
      if (
        handle.approvals.length === 0 &&
        handle.status === "waiting-approval"
      ) {
        handle.status = "running";
      }
      break;
    case "RunStatusChanged":
      if (event.status) pushLine(handle, `run status: ${event.status}`);
      break;
    default:
      break;
  }
}

/**
 * Execution seam, selected via AOMI_BUILD_RUNNER: "local" runs the workflow
 * in this process (dev, single host); "vercel-sandbox" dispatches
 * `aomi-smither run-plan` into a sandbox booted from the golden image
 * (infra/build-runner). Snapshots never care — they read the shared store
 * either way (Phase 1).
 */
function runnerKind(): "local" | "vercel-sandbox" {
  const kind = process.env.AOMI_BUILD_RUNNER ?? "local";
  if (kind !== "local" && kind !== "vercel-sandbox") {
    throw new BuildEngineError(`unknown AOMI_BUILD_RUNNER "${kind}"`, 503);
  }
  return kind;
}

function execute(handle: RunHandle, prepared: PreparedRun) {
  void executeRunUntilSettled(prepared, {
    onEvent: (event) => reduceEvent(handle, event as EngineEvent),
  })
    .then(async (result) => {
      // Snapshot reads derive statuses/outputs from the durable store; here
      // we only keep the in-memory garnish coherent.
      const status = String(result.status);
      handle.status =
        status === "finished" || status === "continued"
          ? "completed"
          : status === "waiting-approval" || status === "waiting-event"
            ? (status as BuildRunStatus)
            : "failed";
      if (handle.status === "failed" && result.error !== undefined) {
        handle.error =
          result.error instanceof Error
            ? result.error.message
            : typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error);
      }
      pushLine(
        handle,
        `run settled: ${status}${handle.error ? ` — ${handle.error.slice(0, 400)}` : ""}`,
      );
      if (handle.status === "completed" || handle.status === "failed") {
        await updateRun(handle.api, handle.runId, {
          status: handle.status,
        }).catch((error: unknown) =>
          buildFailures.handle(
            identifyEngineFailure(error, "build.background_store_update"),
          ),
        );
      }
    })
    .catch(async (error: unknown) => {
      handle.status = "failed";
      handle.error = error instanceof Error ? error.message : String(error);
      pushLine(handle, `run failed: ${handle.error}`);
      buildFailures.handle(
        identifyEngineFailure(error, "build.background_execute"),
      );
      await updateRun(handle.api, handle.runId, { status: "failed" }).catch(
        (updateError: unknown) =>
          buildFailures.handle(
            identifyEngineFailure(
              updateError,
              "build.background_failure_store_update",
            ),
          ),
      );
    });
}

/** The BuildPlan for an app — deterministic given (app, story), so observer
 *  processes can recompose the identical stage shape without the original
 *  request (the story only flavors agent prompts). `sdkRootOverride` targets
 *  a filesystem this process can't see (the sandbox image); spec detection
 *  is skipped there, so remote runs always go through discovery for now. */
function composePlan(
  app: string,
  userStory: string,
  autoApprove = true,
  sdkRootOverride?: string,
  builder: "claude" | "codex" | "none" = "claude",
): BuildPlan {
  const root = sdkRootOverride ?? sdkRoot();
  // An app that already carries a discovered/curated spec resumes idempotently
  // (gen-* keeps curated projects); a fresh app goes through spec discovery.
  const hasSpec = sdkRootOverride
    ? false
    : existsSync(path.join(root, "apps", app, "openapi.yaml"));
  const { plan, issues } = finalizePlan({
    app,
    sdkRoot: root,
    source: hasSpec ? "existing" : "discover",
    userStory,
    builder,
    // No web surface answers gates yet — run unattended by default. The
    // decision route exists, so callers can opt back in per run.
    autoApprove,
    // Dev knob: accept a dirty/behind SDK checkout and reuse its prebuilt
    // release binaries instead of failing the binaries phase.
    allowStaleSdk: process.env.AOMI_ALLOW_STALE_SDK === "1",
  });
  if (!plan) {
    throw new BuildEngineError(`invalid build plan: ${issues.join("; ")}`, 400);
  }
  return plan;
}

export async function startBuildRun(options: {
  prompt: string;
  owner: string;
  app?: string;
  autoApprove?: boolean;
  builder?: "claude" | "codex" | "none";
}): Promise<RunHandle> {
  const app = options.app ?? appSlugFromPrompt(options.prompt);
  const api = await apiFor(app);
  // Identity lives in the registry: (owner, app) → run. Alice's arb-bot and
  // Bob's arb-bot are distinct rows, distinct runs, distinct sandboxes.
  const record = await findRunByOwnerApp(api, options.owner, app);

  const inMemory = record && registry().byRunId.get(record.runId);
  if (
    inMemory &&
    inMemory.status !== "completed" &&
    inMemory.status !== "failed"
  ) {
    return inMemory;
  }
  if (record?.status === "running") {
    // Another instance (or a past life of this one) is executing. Trust the
    // store: still live → observe, don't double-dispatch; dead → resume.
    const view = await readRunView(api, record.runId).catch(
      (error: unknown) => {
        buildFailures.handle(
          identifyEngineFailure(error, "build.resume_store_read"),
        );
        return undefined;
      },
    );
    const live = view && runStatusFromView(view.status) === "running";
    if (live) {
      const observer = await observerHandle(record, api).catch(
        (error: unknown) => {
          buildFailures.handle(
            identifyEngineFailure(error, "build.resume_observer_store_read"),
          );
          return undefined;
        },
      );
      if (observer) return observer;
    }
  }

  const now = new Date().toISOString();
  let handle: RunHandle;

  if (runnerKind() === "vercel-sandbox") {
    // The BFF composes and registers; the sandbox executes. Re-creating a
    // settled app reuses its run id so run-plan resumes from store state.
    const config = sandboxRunnerConfig();
    const plan = composePlan(
      app,
      options.prompt,
      options.autoApprove ?? true,
      config.sdkRoot,
      options.builder,
    );
    const runId =
      record?.runId ?? `smither-${sanitizeAppName(app)}-${crypto.randomUUID()}`;
    const dispatch = await dispatchSandboxRun({
      planJson: JSON.stringify(plan),
      app,
      runId,
      config,
      sidecarPublicKeyPem: sidecarVerifierPublicKeyPem(),
    });
    handle = {
      runId,
      app,
      owner: options.owner,
      plan,
      api,
      dispatch,
      status: "running",
      stageStatus: {},
      stageTimes: {},
      approvals: [],
      lines: [
        `dispatched run ${runId} to sandbox ${dispatch.sandbox.sandboxId}`,
      ],
      createdAt: now,
      updatedAt: now,
    };
    await registerRun(api, {
      runId,
      ownerLogin: options.owner,
      app,
      runner: "vercel-sandbox",
      status: "running",
      sandboxId: dispatch.sandbox.sandboxId,
      sidecarUrl: dispatch.sidecarUrl ?? "",
      planJson: JSON.stringify(plan),
    });
    // The system, not the page, owns sandbox lifetime from here.
    ensureSupervisorInterval();
  } else {
    const plan = composePlan(
      app,
      options.prompt,
      options.autoApprove ?? true,
      undefined,
      options.builder,
    );
    const prepared = await prepareRun({
      plan,
      deps: { env: process.env },
      runsRoot: runsRoot(),
      api,
    });
    handle = {
      runId: prepared.runId,
      app,
      owner: options.owner,
      plan,
      api: prepared.api,
      prepared,
      status: "running",
      stageStatus: {},
      stageTimes: {},
      approvals: [],
      lines: [
        `${prepared.resume ? "resuming" : "starting"} run ${prepared.runId} (state: ${prepared.stateLocation})`,
      ],
      createdAt: now,
      updatedAt: now,
    };
    await registerRun(api, {
      runId: prepared.runId,
      ownerLogin: options.owner,
      app,
      runner: "local",
      status: "running",
      sandboxId: "",
      sidecarUrl: "",
      planJson: JSON.stringify(plan),
    });
    execute(handle, prepared);
  }

  registry().byRunId.set(handle.runId, handle);
  registry().byApp.set(app, handle);
  return handle;
}

/** Request cancellation of a run. Works from any instance — the cancel is a
 *  durable store write the executing engine polls (local or in-sandbox);
 *  stopping a sandbox we booted is best-effort cleanup on top. */
export async function cancelBuildRun(runId: string): Promise<void> {
  const handle = getBuildRun(runId) ?? (await reconstructBuildRun(runId));
  if (!handle) {
    throw new BuildEngineError(`unknown run: ${runId}`, 404);
  }
  await requestRunCancel(handle.api, handle.runId);
  pushLine(handle, "cancel requested");
  // Registry status flips regardless of whether the engine ever observes the
  // cancel (a dead sandbox can't), so the run never wedges as "running".
  await updateRun(handle.api, handle.runId, { status: "cancelled" }).catch(
    (error: unknown) =>
      buildFailures.handle(
        identifyEngineFailure(error, "build.cancel_store_update"),
      ),
  );
  if (handle.dispatch) {
    await stopSandbox(handle.dispatch);
  } else {
    const record = await findRunById(handle.api, handle.runId).catch(
      (error: unknown) => {
        buildFailures.handle(
          identifyEngineFailure(error, "build.cancel_registry_read"),
        );
        return undefined;
      },
    );
    if (record?.sandboxId) await stopSandboxById(record.sandboxId);
  }
  handle.status = "failed";
}

export function getBuildRun(runId: string): RunHandle | undefined {
  return registry().byRunId.get(runId);
}

/** The crate tarball persisted by the result phase, for runs whose crate
 *  directory this process cannot see (sandbox runs). Null when the run has
 *  no embedded artifact (not settled yet, packaging failed, or over-cap). */
export async function storedCrateTarball(
  handle: RunHandle,
): Promise<Buffer | null> {
  const view = await readRunView(handle.api, handle.runId);
  const artifact = artifactFromOutputs(view.outputs ?? {});
  if (!artifact || artifact.crateTarB64.length === 0) return null;
  return Buffer.from(artifact.crateTarB64, "base64");
}

const MAX_SERVED_FILE_BYTES = 256 * 1024;

/**
 * One file of the generated crate, from the freshest available source:
 * local disk (local runner) → live sidecar (sandbox mid-run) → the store's
 * embedded tarball (after the sandbox is gone). Paths use the display shape
 * ("<app>/src/tool.rs"). Null = not found anywhere.
 */
export async function readRunFile(
  handle: RunHandle,
  relPath: string,
): Promise<Buffer | null> {
  const prefix = `${handle.app}/`;
  if (!relPath.startsWith(prefix)) return null;
  // Local disk, path-jailed.
  const appDir = path.join(handle.plan.sdkRoot, "apps", handle.app);
  const resolved = path.resolve(appDir, relPath.slice(prefix.length));
  if (
    (resolved === appDir || resolved.startsWith(appDir + path.sep)) &&
    existsSync(resolved)
  ) {
    const { readFileSync, statSync } = await import("node:fs");
    const stats = statSync(resolved);
    if (stats.isFile() && stats.size <= MAX_SERVED_FILE_BYTES) {
      return readFileSync(resolved);
    }
  }
  // Live sidecar.
  const record = await findRunById(handle.api, handle.runId).catch(
    (error: unknown) => {
      buildFailures.handle(
        identifyEngineFailure(error, "build.file_registry_read"),
      );
      return undefined;
    },
  );
  if (record?.sidecarUrl && record.status === "running") {
    try {
      // Official service-bearer path: fresh short-lived EdDSA bearer per
      // request (sidecar-auth.ts) — no stored sidecar secret anywhere.
      const bearer = await mintSidecarBearer(handle.runId);
      const res = await fetch(
        `https://${record.sidecarUrl.replace(/^https?:\/\//, "")}/file?path=${encodeURIComponent(relPath)}`,
        {
          headers: { authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(4000),
        },
      );
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      buildFailures.handle(
        identifyEngineFailure(error, "build.file_sidecar_read"),
      );
      // Sidecar unreachable — fall through to the store.
    }
  }
  // Store artifact.
  const tarball = await storedCrateTarball(handle).catch((error: unknown) => {
    buildFailures.handle(
      identifyEngineFailure(error, "build.file_artifact_read", {
        status: 404,
        error: "file not found",
      }),
    );
    return null;
  });
  if (!tarball) return null;
  const { extractFileFromTarGz } = await import("./tar");
  return extractFileFromTarGz(tarball, relPath);
}

const RUN_ID =
  /^smither-(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Exact plan from a registry row, falling back to recomposition for rows
 *  written before plan_json existed. */
function planFromRecord(record: BuildRunRecord): BuildPlan {
  try {
    const { plan } = finalizePlan(JSON.parse(record.planJson));
    if (plan) return plan;
  } catch (error) {
    buildFailures.handle(
      identifyEngineFailure(error, "build.reconstruct_plan"),
    );
    // Fall through to recomposition.
  }
  return composePlan(record.app, "observed run");
}

/** Handle that observes a run without executing it (used for runs another
 *  instance — or a past life of this one — is executing). */
async function observerHandle(
  record: BuildRunRecord,
  api: AomiSmitherApi,
): Promise<RunHandle | undefined> {
  const view = await readRunView(api, record.runId);
  if (view.status === null) return undefined;
  const now = new Date().toISOString();
  const handle: RunHandle = {
    runId: record.runId,
    app: record.app,
    owner: record.ownerLogin,
    plan: planFromRecord(record),
    api,
    status: runStatusFromView(view.status) ?? "running",
    stageStatus: {},
    stageTimes: {},
    approvals: [],
    lines: [`observing run ${record.runId}`],
    createdAt: now,
    updatedAt: now,
  };
  registry().byRunId.set(record.runId, handle);
  return handle;
}

/**
 * Serve a run this process never executed (another instance started it, or a
 * restart dropped the in-memory maps): registry row first (exact plan and
 * owner); the legacy run-id parse covers pre-registry runs. The handle
 * observes; it does not execute.
 */
export async function reconstructBuildRun(
  runId: string,
): Promise<RunHandle | undefined> {
  // Registry rows are keyed by run id but the api connection is keyed by
  // app, which we don't know yet — parse the id for the app either way.
  const app = RUN_ID.exec(runId)?.[1];
  if (!app || sanitizeAppName(app) !== app) return undefined;
  try {
    const api = await apiFor(app);
    const record = await findRunById(api, runId);
    if (record) return await observerHandle(record, api);
    const view = await readRunView(api, runId);
    if (view.status === null) return undefined;
    const now = new Date().toISOString();
    const handle: RunHandle = {
      runId,
      app,
      owner: "unknown",
      plan: composePlan(app, "observed run"),
      api,
      status: runStatusFromView(view.status) ?? "running",
      stageStatus: {},
      stageTimes: {},
      approvals: [],
      lines: [`observing run ${runId}`],
      createdAt: now,
      updatedAt: now,
    };
    registry().byRunId.set(runId, handle);
    return handle;
  } catch (error) {
    buildFailures.handle(identifyEngineFailure(error, "build.reconstruct_run"));
    return undefined;
  }
}

export async function decideBuildRun(options: {
  runId: string;
  nodeId: string;
  iteration: number;
  approve: boolean;
  note?: string;
  selection?: { selected: string; notes?: string };
}): Promise<void> {
  const handle = registry().byRunId.get(options.runId);
  if (!handle) {
    throw new BuildEngineError(`unknown run: ${options.runId}`, 404);
  }
  await decideApproval({
    api: handle.api,
    runId: handle.runId,
    nodeId: options.nodeId,
    iteration: options.iteration,
    approve: options.approve,
    note: options.note,
    decidedBy: "aomi-build-web",
    selection: options.selection,
  });
}

export async function snapshotBuildRun(
  handle: RunHandle,
): Promise<BuildRunSnapshot> {
  // The durable store is the source of truth; the live reducer maps only
  // garnish (sub-poll latency, activity lines, timestamps).
  let view: RunView | undefined;
  try {
    view = await readRunView(handle.api, handle.runId);
  } catch (error) {
    buildFailures.handle(
      identifyEngineFailure(error, "build.snapshot_store_read"),
    );
    pushLine(
      handle,
      `store read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const status =
    (view && runStatusFromView(view.status)) ??
    (handle.status as BuildRunStatus);
  // Serverless-shaped sandbox keepalive: each poll of a live sandbox run
  // lazily extends its timeout; an unpolled run lets the sandbox lapse (the
  // next create resumes it from store state).
  if (
    handle.dispatch &&
    (status === "running" || status === "waiting-approval")
  ) {
    void maybeExtendSandbox(handle.dispatch);
  }
  const stageStatus = view
    ? stageStatusesFromView(
        view,
        (nodeId) => stageKeyForNode(handle.plan, nodeId),
        handle.stageStatus,
      )
    : handle.stageStatus;
  const outputs = view?.outputs ?? {};
  const curation = curationFromOutputs(outputs);
  const result = resultFromOutputs(outputs);
  const error = view?.error ?? handle.error;

  const stages: BuildRunStage[] = stagesFor(handle.plan).map((stage) => ({
    id: stage.id,
    label: stage.label,
    kind: stage.kind,
    status: stageStatus[stage.id] ?? "pending",
    ...(handle.stageTimes[stage.id]
      ? { time: handle.stageTimes[stage.id] }
      : {}),
    ...(stage.branchOf ? { branchOf: stage.branchOf } : {}),
    ...(stage.clarify ? { clarify: stage.clarify } : {}),
  }));
  // Files: prefer a live local walk (fresh mid-run on local runners); fall
  // back to the artifact persisted by the result phase — the only source for
  // sandbox runs, whose filesystem this process never sees.
  const codegenDone =
    stageStatus[`${handle.app}:codegen`] === "complete" ||
    status === "completed";
  let fileTree = codegenDone
    ? crateFileTree(
        path.join(handle.plan.sdkRoot, "apps", handle.app),
        handle.app,
      )
    : [];
  if (fileTree.length === 0) {
    fileTree = artifactFromOutputs(outputs)?.fileTree ?? [];
  }
  return {
    runId: handle.runId,
    app: handle.app,
    status,
    stages,
    approvals: handle.approvals,
    lines: handle.lines.slice(-40),
    fileTree,
    ...(curation ? { curation } : {}),
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
    createdAt: handle.createdAt,
    updatedAt: handle.updatedAt,
  };
}
