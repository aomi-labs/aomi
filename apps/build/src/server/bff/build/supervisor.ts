import "server-only";

import type { FailureInput } from "@aomi-labs/observability";
import {
  createAomiSmither,
  resolveRunBackend,
  storeQuery,
  type AomiSmitherApi,
} from "@aomi-labs/smither";
import { listRunningRuns, updateRun, type BuildRunRecord } from "./registry";
import { extendSandboxById, stopSandboxById } from "./sandbox-runner";
import { buildFailures } from "@/server/bff/failures";

function identifySupervisorFailure(
  error: unknown,
  operation: string,
): FailureInput {
  return {
    source: "local",
    error,
    context: { routeFamily: "/api/bff/build/supervise", operation },
  };
}

/**
 * System-owned sandbox lifetime: the build lives exactly as long as the
 * engine is doing work — not as long as someone watches the page. A periodic
 * tick (Vercel Cron in prod, an in-process interval in the long-lived dev
 * server) reads the registry, joins the engine's own heartbeat from the run
 * store, and extends, reaps, or releases each sandbox.
 */

/** No first store write within this window ⇒ the VM died silently (the
 *  stale-OIDC failure mode) — kill it instead of letting it idle to timeout. */
const FIRST_HEARTBEAT_GRACE_MS = 2 * 60_000;
/** Engine heartbeat older than this on a "running" run ⇒ engine is dead. */
const HEARTBEAT_STALE_MS = 3 * 60_000;

export type SuperviseDecision =
  | "extend"
  | "reap-silent"
  | "reap-stale"
  | "release-completed"
  | "release-failed"
  | "release-cancelled"
  | "none";

/** Pure decision for one running registry row. `storeStatus`/`heartbeatAtMs`
 *  come from _smithers_runs; null storeStatus means the engine never wrote. */
export function superviseDecision(input: {
  storeStatus: string | null;
  heartbeatAtMs: number | null;
  registeredAtMs: number;
  nowMs: number;
}): SuperviseDecision {
  const { storeStatus, heartbeatAtMs, registeredAtMs, nowMs } = input;
  switch (storeStatus) {
    case "finished":
    case "continued":
      return "release-completed";
    case "failed":
    case "waiting-quota":
      return "release-failed";
    case "cancelled":
      return "release-cancelled";
    case null:
      return nowMs - registeredAtMs > FIRST_HEARTBEAT_GRACE_MS
        ? "reap-silent"
        : "none";
    default: {
      // running / waiting-approval / waiting-event / waiting-timer.
      const beat = heartbeatAtMs ?? 0;
      if (nowMs - beat > HEARTBEAT_STALE_MS) return "reap-stale";
      return "extend";
    }
  }
}

const SUPERVISOR_KEY = Symbol.for("aomi-build.supervisor");

type SupervisorState = {
  api?: Promise<AomiSmitherApi>;
  interval?: ReturnType<typeof setInterval>;
};

function state(): SupervisorState {
  const holder = globalThis as { [SUPERVISOR_KEY]?: SupervisorState };
  holder[SUPERVISOR_KEY] ??= {};
  return holder[SUPERVISOR_KEY];
}

function supervisorApi(): Promise<AomiSmitherApi> {
  const s = state();
  s.api ??= createAomiSmither(resolveRunBackend("supervisor"));
  return s.api;
}

export type SuperviseAction = {
  runId: string;
  app: string;
  decision: SuperviseDecision;
};

async function applyDecision(
  api: AomiSmitherApi,
  record: BuildRunRecord,
  decision: SuperviseDecision,
): Promise<void> {
  const stop = async () => {
    if (record.sandboxId) await stopSandboxById(record.sandboxId);
  };
  switch (decision) {
    case "extend":
      if (record.sandboxId) {
        const ok = await extendSandboxById(record.sandboxId);
        if (!ok) {
          // Healthy engine but unreachable sandbox: it lapsed or was stopped
          // out-of-band. The run will die shortly; mark it now.
          await updateRun(api, record.runId, { status: "failed" });
        }
      }
      break;
    case "reap-silent":
    case "reap-stale":
      await stop();
      await updateRun(api, record.runId, { status: "failed" });
      break;
    case "release-completed":
      await stop();
      await updateRun(api, record.runId, { status: "completed" });
      break;
    case "release-failed":
      await stop();
      await updateRun(api, record.runId, { status: "failed" });
      break;
    case "release-cancelled":
      await stop();
      await updateRun(api, record.runId, { status: "cancelled" });
      break;
    case "none":
      break;
  }
}

/** One supervision pass over every registry row still marked running. */
export async function superviseOnce(): Promise<SuperviseAction[]> {
  const api = await supervisorApi();
  const running = await listRunningRuns(api);
  const actions: SuperviseAction[] = [];
  for (const record of running) {
    let storeStatus: string | null = null;
    let heartbeatAtMs: number | null = null;
    try {
      const row = (
        await storeQuery(
          api,
          `SELECT status, heartbeat_at_ms FROM _smithers_runs WHERE run_id = ? LIMIT 1`,
          [record.runId],
        )
      )[0];
      if (row) {
        storeStatus = String(row.status ?? "") || null;
        heartbeatAtMs =
          row.heartbeat_at_ms === null || row.heartbeat_at_ms === undefined
            ? null
            : Number(row.heartbeat_at_ms);
      }
    } catch (error) {
      buildFailures.handle(
        identifySupervisorFailure(error, "build.supervisor_store_read"),
      );
      // Store hiccup: decide "none" this tick rather than reaping blind.
      actions.push({ runId: record.runId, app: record.app, decision: "none" });
      continue;
    }
    const decision = superviseDecision({
      storeStatus,
      heartbeatAtMs,
      registeredAtMs: record.updatedAtMs || record.createdAtMs,
      nowMs: Date.now(),
    });
    try {
      await applyDecision(api, record, decision);
    } catch (error) {
      buildFailures.handle(
        identifySupervisorFailure(error, "build.supervisor_apply_decision"),
      );
    }
    actions.push({ runId: record.runId, app: record.app, decision });
  }
  return actions;
}

const TICK_MS = 60_000;

/** In-process tick for long-lived servers (next dev / self-hosted). On
 *  Vercel, functions don't outlive requests — the cron route is the tick. */
export function ensureSupervisorInterval(): void {
  const s = state();
  if (s.interval) return;
  s.interval = setInterval(() => {
    void superviseOnce().catch((error: unknown) =>
      buildFailures.handle(
        identifySupervisorFailure(error, "build.supervisor_interval"),
      ),
    );
  }, TICK_MS);
  // Never hold the process open just to supervise.
  if (typeof s.interval === "object" && "unref" in s.interval) {
    s.interval.unref();
  }
}
