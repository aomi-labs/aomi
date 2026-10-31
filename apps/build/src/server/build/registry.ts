import "@tanstack/react-start/server-only";

import { storeQuery, type AomiSmitherApi } from "@aomi-labs/smither";

/**
 * Durable run registry, keyed by (owner, app): the identity layer the
 * smithers store deliberately doesn't have. Alice's "arb-bot" and Bob's
 * "arb-bot" are distinct rows pointing at distinct runs; a BFF restart looks
 * runs up here instead of minting new ids; the supervisor reads sandbox ids
 * from here to extend or reap.
 *
 * Lives in the same store as the run state (created idempotently on first
 * use) — the embedded PGlite backend cannot be opened twice in one process,
 * so all access rides the run api's connection via storeQuery.
 */

export type BuildRunRecord = {
  runId: string;
  ownerLogin: string;
  app: string;
  runner: "local" | "vercel-sandbox";
  status: "running" | "completed" | "failed" | "cancelled";
  sandboxId: string;
  sidecarUrl: string;
  planJson: string;
  createdAtMs: number;
  updatedAtMs: number;
};

const ENSURED = new WeakSet<object>();

async function ensureRegistry(api: AomiSmitherApi): Promise<void> {
  if (ENSURED.has(api as object)) return;
  await storeQuery(
    api,
    `CREATE TABLE IF NOT EXISTS aomi_build_runs (
       run_id TEXT PRIMARY KEY,
       owner_login TEXT NOT NULL,
       app TEXT NOT NULL,
       runner TEXT NOT NULL,
       status TEXT NOT NULL,
       sandbox_id TEXT NOT NULL DEFAULT '',
       sidecar_url TEXT NOT NULL DEFAULT '',
       plan_json TEXT NOT NULL,
       created_at_ms BIGINT NOT NULL,
       updated_at_ms BIGINT NOT NULL
     )`,
  );
  await storeQuery(
    api,
    `CREATE UNIQUE INDEX IF NOT EXISTS aomi_build_runs_owner_app
       ON aomi_build_runs (owner_login, app)`,
  );
  ENSURED.add(api as object);
}

function toRecord(row: Record<string, unknown>): BuildRunRecord {
  return {
    runId: String(row.run_id),
    ownerLogin: String(row.owner_login),
    app: String(row.app),
    runner: row.runner === "vercel-sandbox" ? "vercel-sandbox" : "local",
    status: ["completed", "failed", "cancelled"].includes(String(row.status))
      ? (String(row.status) as BuildRunRecord["status"])
      : "running",
    sandboxId: String(row.sandbox_id ?? ""),
    sidecarUrl: String(row.sidecar_url ?? ""),
    planJson: String(row.plan_json ?? ""),
    createdAtMs: Number(row.created_at_ms ?? 0),
    updatedAtMs: Number(row.updated_at_ms ?? 0),
  };
}

export async function findRunByOwnerApp(
  api: AomiSmitherApi,
  ownerLogin: string,
  app: string,
): Promise<BuildRunRecord | undefined> {
  await ensureRegistry(api);
  const rows = await storeQuery(
    api,
    `SELECT * FROM aomi_build_runs WHERE owner_login = ? AND app = ? LIMIT 1`,
    [ownerLogin, app],
  );
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function findRunById(
  api: AomiSmitherApi,
  runId: string,
): Promise<BuildRunRecord | undefined> {
  await ensureRegistry(api);
  const rows = await storeQuery(
    api,
    `SELECT * FROM aomi_build_runs WHERE run_id = ? LIMIT 1`,
    [runId],
  );
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function listRunningRuns(
  api: AomiSmitherApi,
): Promise<BuildRunRecord[]> {
  await ensureRegistry(api);
  const rows = await storeQuery(
    api,
    `SELECT * FROM aomi_build_runs WHERE status = 'running'`,
  );
  return rows.map(toRecord);
}

/** Insert or replace the (owner, app) slot with a run. One registry row per
 *  (owner, app); re-registering the same run refreshes runner/plan fields. */
export async function registerRun(
  api: AomiSmitherApi,
  record: Omit<BuildRunRecord, "createdAtMs" | "updatedAtMs">,
): Promise<void> {
  await ensureRegistry(api);
  const now = Date.now();
  // One row per (owner, app): a re-mint (fresh run id for the same slot)
  // replaces the previous run rather than colliding on the unique index.
  await storeQuery(
    api,
    `DELETE FROM aomi_build_runs
      WHERE owner_login = ? AND app = ? AND run_id <> ?`,
    [record.ownerLogin, record.app, record.runId],
  );
  await storeQuery(
    api,
    `INSERT INTO aomi_build_runs
       (run_id, owner_login, app, runner, status, sandbox_id, sidecar_url,
        plan_json, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id) DO UPDATE SET
       runner = excluded.runner,
       status = excluded.status,
       sandbox_id = excluded.sandbox_id,
       sidecar_url = excluded.sidecar_url,
       plan_json = excluded.plan_json,
       updated_at_ms = excluded.updated_at_ms`,
    [
      record.runId,
      record.ownerLogin,
      record.app,
      record.runner,
      record.status,
      // NOT NULL columns: coerce runtime undefined (e.g. an SDK field
      // going missing) to '' instead of failing the whole dispatch.
      record.sandboxId ?? "",
      record.sidecarUrl ?? "",
      record.planJson ?? "",
      now,
      now,
    ],
  );
}

export async function updateRun(
  api: AomiSmitherApi,
  runId: string,
  patch: Partial<Pick<BuildRunRecord, "status" | "sandboxId" | "sidecarUrl">>,
): Promise<void> {
  await ensureRegistry(api);
  const sets: string[] = ["updated_at_ms = ?"];
  const params: unknown[] = [Date.now()];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.sandboxId !== undefined) {
    sets.push("sandbox_id = ?");
    params.push(patch.sandboxId);
  }
  if (patch.sidecarUrl !== undefined) {
    sets.push("sidecar_url = ?");
    params.push(patch.sidecarUrl);
  }
  params.push(runId);
  await storeQuery(
    api,
    `UPDATE aomi_build_runs SET ${sets.join(", ")} WHERE run_id = ?`,
    params,
  );
}
