/** Read public Agent callback events after the first local-fork self-transfer; never send. */
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient } from "../packages/client/src/index.ts";

const required = (name: string) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const origin = new URL(required("AOMI_STABILITY_ORIGIN"));
assert.ok(["127.0.0.1", "localhost", "::1"].includes(origin.hostname));
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const userId = required("AOMI_STABILITY_USER_ID");
const sessionId = required("AOMI_STABILITY_SESSION_ID");
const firstCommitId = required("AOMI_STABILITY_FIRST_COMMIT_ID");
const runId = randomUUID();
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer, "local development issuer fixture missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const agent = new AomiClient({ baseUrl: origin.origin, guest: false,
  oauth: async ({ resource, scopes }) => {
    const { bearer, expiresAt } = await mintAgentApiBearer(userId, { scope: "agent:read", resource,
      client_id: "commit-stability-s02-observe", auth_source: "oauth", principal_class: "user", grant_id: `commit-stability-${runId}` });
    return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
  },
});
const timeline: Record<string, unknown>[] = [];
const result: Record<string, unknown> = { runId, sessionId, firstCommitId, status: "BLOCKED", stageIds: [], sends: 0 };
const toolResult = (value: unknown): Record<string, unknown> | undefined => {
  const body = Array.isArray(value) ? value[1] : value;
  if (typeof body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
};
const seen = new Set<string>();
let page = await agent.agent.poll(sessionId, { waitMs: 0 });
let latestStage: { ids: string[]; eventId: string; sequence: number } | undefined;
let simulationEvent: { eventId: string; sequence: number } | undefined;
const staged: Array<{ id: string; sequence: number; eventId: string; transaction: Record<string, unknown> }> = [];
let callbackTurnId: string | undefined;
let simulationSha256: string | undefined;
const started = performance.now();
while (performance.now() - started < 180_000) {
  for (const item of page.events) {
    if (seen.has(item.event_id)) continue;
    seen.add(item.event_id);
    timeline.push({ at: new Date().toISOString(), monotonicMs: performance.now(), eventId: item.event_id,
      sequence: item.sequence, type: item.type, turnId: item.turn_id,
      toolName: item.type === "tool_complete" || item.type === "tool_update" ? item.tool_name : undefined });
    if (item.turn_id?.startsWith("broadcast-terminal:")) callbackTurnId = item.turn_id;
    const name = item.type === "message" ? item.tool_name : item.type === "tool_complete" ? item.tool_name : undefined;
    const detail = item.type === "message" ? toolResult(item.tool_result) : item.type === "tool_complete" ? toolResult(item.result) : undefined;
    if (item.turn_id === callbackTurnId && name === "evm_stage_tx" && typeof detail?.pending_tx_id === "number") {
      staged.push({ id: `evm:${detail.pending_tx_id}`, eventId: item.event_id, sequence: item.sequence,
        transaction: { chain_id: detail.chain_id, from: detail.from, to: detail.to, value: detail.value, data: detail.data } });
      const distinct = [...new Map(staged.map((row) => [row.id, row])).values()].sort((a, b) => a.sequence - b.sequence);
      if (distinct.length >= 2) latestStage = { ids: distinct.map((row) => row.id), eventId: item.event_id, sequence: item.sequence };
    }
    if (item.turn_id === callbackTurnId && name === "simulate_batch" && detail?.batch_success === true) {
      const simulated = Array.isArray(detail.resolved_ids) ? detail.resolved_ids.map((id) => `evm:${id}`) : [];
      if (latestStage && JSON.stringify(simulated) === JSON.stringify(latestStage.ids))
        simulationEvent = { eventId: item.event_id, sequence: item.sequence };
      if (simulationEvent) simulationSha256 = createHash("sha256").update(JSON.stringify(detail.simulation)).digest("hex");
    }
  }
  const commits = page.commits ?? [];
  const first = commits.find((item) => item.commit_id === firstCommitId);
  if (!first || first.state !== "confirmed") {
    result.observed = "first self-transfer has not reached durable confirmed state";
  } else if (latestStage && simulationEvent && simulationEvent.sequence > latestStage.sequence) {
    const extra = commits.filter((item) => item.commit_id !== firstCommitId && !["rejected", "failed", "expired"].includes(item.state));
    if (extra.length) {
      result.observed = "Agent committed a follow-up before natural authorization; S02 cannot proceed without new fixture";
      result.status = "FAIL";
    } else if (latestStage.ids.length === 2) {
      result.status = "PASS";
      result.observed = "Callback staged exactly two EVM IDs and emitted a later simulation tool result; no follow-up commit or wallet send before natural confirmation. Review exact content after commit.";
      result.stageIds = latestStage.ids;
      result.stageTransactions = latestStage.ids.map((id) => staged.find((row) => row.id === id)?.transaction);
      result.simulationSha256 = simulationSha256;
      result.stageEventId = latestStage.eventId;
      result.simulationEventId = simulationEvent.eventId;
    } else {
      result.observed = `callback stage tool exposed ${latestStage.ids.length} IDs, expected two`;
    }
    if (result.status !== "BLOCKED") break;
  }
  page = await agent.agent.poll(sessionId, { cursor: page.cursor, waitMs: 10_000 });
}
if (!result.observed) result.observed = "callback did not expose a staged/simulated pair within 180s";
await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
await writeFile(join(out, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify({ runId, status: result.status, evidence: out, sessionId }));
if (result.status !== "PASS") process.exitCode = 1;
