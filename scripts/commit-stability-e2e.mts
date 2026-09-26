/**
 * Local commit-stability probe. It uses the public SDK and the workspace's
 * running API, and never signs or broadcasts a wallet transaction.
 *
 * AOMI_PRODUCT_ROOT=/absolute/backend/root \
 * AOMI_STABILITY_ORIGIN=http://127.0.0.1:8086 \
 * AOMI_STABILITY_EVIDENCE=/absolute/evidence/directory \
 * ./node_modules/.bin/tsx scripts/commit-stability-e2e.mts
 *
 * To exercise stage/simulate/commit preparation, also set a local test user,
 * chain and wallet with AOMI_STABILITY_USER_ID, AOMI_STABILITY_CHAIN_ID and
 * AOMI_STABILITY_WALLET. Commit preparation is opt-in via
 * AOMI_STABILITY_PREPARE_COMMIT=1. This does not execute wallet requests.
 */
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient } from "../packages/client/src/index.ts";

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";
type Case = {
  id: string;
  runner: "T";
  preconditions: string;
  action: string;
  expected: string;
  observed: string;
  status: Status;
  evidence: string[];
};

const backendRoot = process.env.AOMI_PRODUCT_ROOT;
const origin = process.env.AOMI_STABILITY_ORIGIN;
const evidence = process.env.AOMI_STABILITY_EVIDENCE;
assert.ok(backendRoot && origin && evidence, "Set AOMI_PRODUCT_ROOT, AOMI_STABILITY_ORIGIN, and AOMI_STABILITY_EVIDENCE");
const apiUrl = new URL(origin);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname), "This probe only accepts a loopback API origin");
const runId = randomUUID();
const output = resolve(evidence, runId);
await mkdir(output, { recursive: true, mode: 0o700 });

function revision(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}
function redactedError(error: unknown): string {
  const record = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof record?.code === "string" ? record.code : "unknown";
  const status = typeof record?.status === "number" ? record.status : "unknown";
  const message = typeof record?.message === "string" ? record.message : "error";
  return `${code} (${status}): ${message.replace(/Bearer\s+\S+|0x[a-fA-F0-9]{64}|https?:\/\/\S+@/g, "[redacted]").slice(0, 180)}`;
}
function isBuildIntegrityRejection(error: unknown): boolean {
  const record = error as { status?: unknown; code?: unknown; details?: unknown };
  const details = JSON.stringify(record?.details ?? null);
  return record?.status === 422 &&
    record?.code === "backend_rejected" &&
    details.includes("pipeline_build_rejected") &&
    /(digest|attestation)/i.test(details);
}
const cases: Case[] = [];
function record(input: Omit<Case, "evidence"> & { evidence?: string[] }): void {
  cases.push({ ...input, evidence: input.evidence ?? [] });
}
async function save(): Promise<void> {
  await writeFile(join(output, "cases.json"), JSON.stringify(cases, null, 2) + "\n", { mode: 0o600 });
}

const frontendRoot = resolve(import.meta.dirname, "..");
const manifest = {
  schemaVersion: 1,
  runId,
  timestamp: new Date().toISOString(),
  clockBasis: "UTC wall clock; process phase durations use monotonic performance.now()",
  backendRevision: revision(backendRoot),
  frontendRevision: revision(frontendRoot),
  apiOrigin: apiUrl.origin,
  environment: "isolated local workspace",
  serviceTopology: "managed aomi-dev full local portal, backend, API, manager, commit/payment services",
  chainId: Number(process.env.AOMI_STABILITY_CHAIN_ID ?? 0) || null,
  walletProvider: process.env.AOMI_STABILITY_WALLET ? "configured local test account" : "none",
  modelRouting: process.env.AOMI_STABILITY_MODEL_ALIAS ?? "not exercised",
  sendsAuthorizedByRunner: false,
};
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });

const timeline: Array<Record<string, unknown>> = [];
function phase(name: string, detail?: Record<string, unknown>): void {
  timeline.push({ runId, phase: name, at: new Date().toISOString(), monotonicMs: performance.now(), ...detail });
}
phase("probe_started");

let client: AomiClient;
try {
  const fixture = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
    .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
  assert.ok(fixture, "development issuer fixture is unavailable");
  process.env.PORTAL_SERVICE_PRIVATE_KEY = fixture[1];
  const userId = process.env.AOMI_STABILITY_USER_ID ?? "11111111-1111-4111-8111-111111111111";
  const { bearer } = await mintAgentApiBearer(userId, {
    scope: "pipeline:catalog pipeline:execute",
    resource: `${apiUrl.origin}/v1/pipeline`,
    client_id: "commit-stability-e2e",
    auth_source: "oauth",
    principal_class: "user",
    grant_id: `commit-stability-${runId}`,
  });
  client = new AomiClient({
    baseUrl: apiUrl.origin,
    guest: false,
    oauth: async ({ resource, scopes }) => ({ accessToken: bearer, expiresAt: Number.MAX_SAFE_INTEGER, resource, scopes, tokenType: "Bearer" as const }),
  });
  phase("auth_ready", { principalClass: "local test user" });
} catch (error) {
  record({ id: "T00", runner: "T", preconditions: "local API and dev issuer fixture", action: "mint local Pipeline bearer", expected: "usable local authority", observed: redactedError(error), status: "BLOCKED" });
  await save();
  throw error;
}

try {
  const root = await client.pipeline.root();
  const apps = await client.pipeline.apps.list();
  assert.ok(root.entries.length > 0 && apps.entries.length > 0);
  phase("catalog_read", { rootEntries: root.entries.length, appEntries: apps.entries.length });
  record({ id: "T00", runner: "T", preconditions: "local API and dev issuer fixture", action: "read public Pipeline catalog", expected: "nonempty root and app entries", observed: `root=${root.entries.length}; apps=${apps.entries.length}`, status: "PASS" });
} catch (error) {
  record({ id: "T00", runner: "T", preconditions: "local API and dev issuer fixture", action: "read public Pipeline catalog", expected: "nonempty root and app entries", observed: redactedError(error), status: "FAIL" });
}

const wallet = process.env.AOMI_STABILITY_WALLET;
const chainId = Number(process.env.AOMI_STABILITY_CHAIN_ID ?? 0);
if (!wallet || !/^0x[\da-fA-F]{40}$/.test(wallet) || !Number.isSafeInteger(chainId) || chainId <= 0) {
  record({ id: "T01", runner: "T", preconditions: "local test user, EVM wallet, chain", action: "zero-value self-transfer stage, simulate, reconstruct client, prepare unchanged commit", expected: "same digest and ordered IDs", observed: "wallet or chain fixture absent", status: "BLOCKED" });
  record({ id: "P04", runner: "T", preconditions: "simulated Build", action: "change one action value", expected: "integrity rejection, no wallet request", observed: "simulation fixture absent", status: "BLOCKED" });
} else {
  const action = {
    to: wallet,
    description: "zero-value stability preparation probe",
    data: { signature: "", args: [], raw: "0x" },
    chain_id: chainId,
    value: "0",
    gas_limit: "21000",
  };
  try {
    phase("stage_start");
    const staged = await client.pipeline.evm.stage({ actions: [action] });
    phase("stage_end", { digest: staged.digest, actionCount: staged.actions.length });
    const simulated = await client.pipeline.evm.simulate(staged);
    phase("simulate_end", { digest: simulated.digest, status: simulated.simulation.status });
    assert.equal(staged.digest, simulated.digest);
    assert.equal(staged.actions.length, simulated.actions.length);
    const tampered = { ...simulated, actions: [{ ...simulated.actions[0], value: "1" }] };
    try {
      await client.pipeline.evm.commit(tampered as never, { idempotencyKey: `${runId}-tamper` });
      record({ id: "P04", runner: "T", preconditions: "simulated Build", action: "change one action value", expected: "integrity rejection, no wallet request", observed: "tampered Build accepted", status: "FAIL" });
    } catch (error) {
      phase("tamper_rejected");
      record({ id: "P04", runner: "T", preconditions: "simulated Build", action: "change one action value", expected: "integrity rejection, no wallet request", observed: redactedError(error), status: isBuildIntegrityRejection(error) ? "PASS" : "FAIL" });
    }
    if (process.env.AOMI_STABILITY_PREPARE_COMMIT === "1") {
      const { bearer } = await mintAgentApiBearer(process.env.AOMI_STABILITY_USER_ID ?? "11111111-1111-4111-8111-111111111111", {
        scope: "pipeline:catalog pipeline:execute", resource: `${apiUrl.origin}/v1/pipeline`, client_id: "commit-stability-e2e", auth_source: "oauth", principal_class: "user", grant_id: `commit-stability-${runId}`,
      });
      const reloaded = new AomiClient({ baseUrl: apiUrl.origin, guest: false, oauth: async ({ resource, scopes }) => ({ accessToken: bearer, expiresAt: Number.MAX_SAFE_INTEGER, resource, scopes, tokenType: "Bearer" as const }) });
      const result = await reloaded.pipeline.evm.commit(simulated, { idempotencyKey: `${runId}-unchanged` });
      phase("commit_prepared", { digest: result.digest, requestCount: result.requests.length });
      assert.equal(result.digest, staged.digest);
      record({ id: "T01", runner: "T", preconditions: "local test user, EVM wallet, chain", action: "zero-value self-transfer stage, simulate, reconstruct client, prepare unchanged commit", expected: "same digest and ordered IDs", observed: `digest preserved; actions=${staged.actions.length}; wallet requests=${result.requests.length}; no send`, status: "PASS" });
    } else {
      record({ id: "T01", runner: "T", preconditions: "local test user, EVM wallet, chain", action: "zero-value self-transfer stage, simulate, reconstruct client, prepare unchanged commit", expected: "same digest and ordered IDs", observed: "stage and simulation completed; commit preparation opt-in", status: "BLOCKED" });
    }
  } catch (error) {
    phase("pipeline_error", { error: redactedError(error) });
    record({ id: "T01", runner: "T", preconditions: "local test user, EVM wallet, chain", action: "zero-value self-transfer stage, simulate, reconstruct client, prepare unchanged commit", expected: "same digest and ordered IDs", observed: redactedError(error), status: "FAIL" });
    if (!cases.some((row) => row.id === "P04")) record({ id: "P04", runner: "T", preconditions: "simulated Build", action: "change one action value", expected: "integrity rejection, no wallet request", observed: "simulation did not complete", status: "BLOCKED" });
  }
}

phase("probe_finished");
await writeFile(join(output, "timeline.jsonl"), timeline.map((event) => JSON.stringify(event)).join("\n") + "\n", { mode: 0o600 });
await save();
await writeFile(join(output, "README.md"), `# Commit stability probe ${runId}\n\nAPI: ${apiUrl.origin}\n\nBackend: ${manifest.backendRevision}\nFrontend: ${manifest.frontendRevision}\n\nThis probe uses the public SDK against local services. A prepared commit is not a wallet send or receipt. See cases.json and timeline.jsonl.\n`, { mode: 0o600 });
console.log(JSON.stringify({ runId, evidence: output, cases: cases.map(({ id, status }) => ({ id, status })) }));
if (cases.some((row) => row.status === "FAIL")) process.exitCode = 1;
