/** Cold public-API readback of one existing disposable-wallet commit and callback. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { mintAccountBearer, mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const required = (name: string) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const agentOrigin = new URL(required("AOMI_STABILITY_ORIGIN"));
const commitOrigin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
const rpcOrigin = new URL(required("AOMI_STABILITY_LOCAL_RPC"));
for (const url of [agentOrigin, commitOrigin, rpcOrigin]) {
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "all origins must be loopback");
}
const userId = required("AOMI_STABILITY_USER_ID");
const sessionId = required("AOMI_STABILITY_SESSION_ID");
const commitId = required("AOMI_STABILITY_COMMIT_ID");
const expectedHash = required("AOMI_STABILITY_TRANSACTION_HASH").toLowerCase();
const expectedWallet = required("AOMI_STABILITY_WALLET").toLowerCase();
assert.match(expectedHash, /^0x[0-9a-f]{64}$/);
assert.match(expectedWallet, /^0x[0-9a-f]{40}$/);
const runId = randomUUID();
const output = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
await writeFile(join(output, "manifest.json"), JSON.stringify({
  schemaVersion: 1, runId, timestamp: new Date().toISOString(),
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: revision(backendRoot),
  frontendRunnerRevision: revision(resolve(import.meta.dirname, "..")),
  databaseMigrationDigest: required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  managerRevision: required("AOMI_STABILITY_MANAGER_REVISION"),
  anvilBinarySha256: required("AOMI_STABILITY_ANVIL_SHA256"),
  agentOrigin: agentOrigin.origin, commitOrigin: commitOrigin.origin,
  executionRpc: rpcOrigin.origin, chainId: 8453,
  sessionId, commitId, expectedHash, expectedWallet,
}, null, 2) + "\n", { mode: 0o600 });

const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer, "local development issuer fixture missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const agentClient = new AomiClient({
  baseUrl: agentOrigin.origin, guest: false,
  oauth: async ({ resource, scopes }) => {
    const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
      scope: "agent:read agent:write agent:actions:resolve",
      resource, client_id: "commit-stability-readback", auth_source: "oauth",
      principal_class: "user", grant_id: `commit-stability-readback-${runId}`,
    });
    return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
  },
});
const commitClient = new AomiClient({
  baseUrl: commitOrigin.origin, guest: false,
  getAccountBearer: async () => (await mintAccountBearer(userId)).bearer,
});
const chain = createPublicClient({ chain: base, transport: http(rpcOrigin.href) });
const timeline: Record<string, unknown>[] = [];
const event = (phase: string, detail: Record<string, unknown> = {}) => timeline.push({ phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...detail });
const result: Record<string, unknown> = { runId, status: "BLOCKED", caseIds: ["W01"], sessionId, commitId, transactionHash: expectedHash };
const commitSession = new Session(commitClient, { sessionId });
try {
  assert.equal(await chain.getChainId(), 8453);
  const view = await commitSession.commits.refresh(commitId);
  assert.equal(view.state, "confirmed", "cold SDK readback must remain confirmed");
  assert.equal(view.transaction_id?.toLowerCase(), expectedHash);
  assert.ok(view.wallet_attempt?.attempt_id, "durable wallet attempt must survive reload");
  event("cold_commit_readback", { state: view.state, version: view.version, attemptId: view.wallet_attempt.attempt_id });

  const receipt = await chain.getTransactionReceipt({ hash: expectedHash as `0x${string}` });
  const transaction = await chain.getTransaction({ hash: expectedHash as `0x${string}` });
  assert.equal(receipt.status, "success");
  assert.equal(transaction.from.toLowerCase(), expectedWallet);
  assert.equal(transaction.to?.toLowerCase(), expectedWallet);
  assert.equal(transaction.value, 0n);
  assert.equal(transaction.input, "0x");
  event("cold_chain_readback", { blockNumber: receipt.blockNumber.toString(), status: receipt.status });
  result.coldReadback = "PASS";

  let cursor: string | undefined;
  const seen = new Set<string>();
  const start = performance.now();
  let finalState: string | undefined;
  while (performance.now() - start < 90_000) {
    const page = await agentClient.agent.poll(sessionId, { cursor, waitMs: 10_000 });
    for (const item of page.events) {
      if (seen.has(item.event_id)) continue;
      seen.add(item.event_id);
      event("agent_event", { eventId: item.event_id, eventType: item.type, sequence: item.sequence,
        state: item.type === "turn_state_changed" ? item.state : undefined });
      if (item.type === "turn_state_changed" && ["complete", "failed", "interrupted"].includes(item.state)) finalState = item.state;
    }
    cursor = page.cursor;
    if (finalState) break;
  }
  result.callbackState = finalState ?? "pending_after_90s";
  result.agentEventCount = seen.size;
  result.status = finalState === "complete" ? "PASS" : "BLOCKED";
} catch (error) {
  const e = error as { name?: string; message?: string };
  result.status = "FAIL";
  result.observed = `${e.name ?? "Error"}: ${String(e.message ?? "").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 250)}`;
  event("readback_error", { name: e.name ?? "Error" });
} finally {
  commitSession.close();
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(output, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ runId, status: result.status, evidence: output }));
if (result.status !== "PASS") process.exitCode = 1;
