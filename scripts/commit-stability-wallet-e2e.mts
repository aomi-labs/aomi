/**
 * Agent → durable commit → wallet attempt → local-chain receipt probe.
 *
 * This script only accepts a loopback RPC and a disposable private-key file.
 * It creates a zero-value self-transfer through the real Agent and Commit
 * Service path. A previously created session/commit can be resumed by setting
 * AOMI_STABILITY_SESSION_ID and AOMI_STABILITY_COMMIT_ID.
 *
 * Required: AOMI_PRODUCT_ROOT, AOMI_STABILITY_ORIGIN,
 * AOMI_STABILITY_LOCAL_RPC, AOMI_STABILITY_LOCAL_KEY_FILE,
 * AOMI_STABILITY_EVIDENCE, AOMI_STABILITY_USER_ID.
 * AOMI_STABILITY_EXECUTE=1 is the explicit local-send switch.
 * Run with ./node_modules/.bin/tsx scripts/commit-stability-wallet-e2e.mts.
 */
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const backendRoot = resolve(requireEnv("AOMI_PRODUCT_ROOT"));
const apiOrigin = new URL(requireEnv("AOMI_STABILITY_ORIGIN"));
const rpcOrigin = new URL(requireEnv("AOMI_STABILITY_LOCAL_RPC"));
const keyFile = resolve(requireEnv("AOMI_STABILITY_LOCAL_KEY_FILE"));
const evidenceRoot = resolve(requireEnv("AOMI_STABILITY_EVIDENCE"));
const userId = requireEnv("AOMI_STABILITY_USER_ID");
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
assert.ok(localHosts.has(apiOrigin.hostname) && localHosts.has(rpcOrigin.hostname), "API and execution RPC must be loopback");
assert.notEqual(await realpath(keyFile), "/home/aron/Documents/Work/Aomi/.env.key", "funded Base key is forbidden for local fault cases");
assert.equal(process.env.AOMI_STABILITY_EXECUTE, "1", "Set AOMI_STABILITY_EXECUTE=1 for the local send");
const rawKey = await readFile(keyFile, "utf8");
const keyMatch = rawKey.match(/0x[0-9a-fA-F]{64}/);
assert.ok(keyMatch, "disposable key file has no 32-byte EVM private key");
const account = privateKeyToAccount(keyMatch[0] as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(rpcOrigin.href) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcOrigin.href) });
assert.equal(await publicClient.getChainId(), 8453, "local execution node must be Base-ID 8453");
const nodeInfo = await fetch(rpcOrigin, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }),
  signal: AbortSignal.timeout(10_000),
});
assert.ok(nodeInfo.ok && (await nodeInfo.json() as { result?: unknown }).result, "execution RPC must be Anvil");
const forkBlockNumber = (await publicClient.getBlockNumber()).toString();
const runId = randomUUID();
const output = resolve(evidenceRoot, runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const frontendRoot = resolve(import.meta.dirname, "..");
const timeline: Record<string, unknown>[] = [];
const event = (phase: string, fields: Record<string, unknown> = {}) => timeline.push({ runId, phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...fields });
const outcome: Record<string, unknown> = { runId, status: "BLOCKED", caseIds: ["W01"], account: account.address };
const flush = async () => {
  await writeFile(join(output, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
  await writeFile(join(output, "result.json"), JSON.stringify(outcome, null, 2) + "\n", { mode: 0o600 });
  const spans: Array<[string, string, string]> = [
    ["agent_to_commit", "agent_start", "commit_discovered"],
    ["wallet_invocation", "wallet_invoked", "wallet_hash"],
    ["chain_receipt", "wallet_hash", "receipt"],
    ["commit_observation", "receipt", "commit_terminal"],
  ];
  const lines = ["run_id,phase,started_utc,duration_ms,status"];
  for (const [name, from, to] of spans) {
    const start = timeline.find((row) => row.phase === from);
    const end = timeline.find((row) => row.phase === to);
    if (start && end) lines.push(`${runId},${name},${start.at},${(Number(end.monotonicMs) - Number(start.monotonicMs)).toFixed(3)},${outcome.status}`);
  }
  await writeFile(join(output, "latency.csv"), lines.join("\n") + "\n", { mode: 0o600 });
};
await writeFile(join(output, "manifest.json"), JSON.stringify({
  schemaVersion: 1, runId, timestamp: new Date().toISOString(), clockBasis: "UTC wall clock and process monotonic time",
  backendRuntimeRevision: requireEnv("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: requireEnv("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: revision(backendRoot), frontendRunnerRevision: revision(frontendRoot),
  databaseMigrationDigest: requireEnv("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  managerRevision: requireEnv("AOMI_STABILITY_MANAGER_REVISION"),
  anvilBinarySha256: requireEnv("AOMI_STABILITY_ANVIL_SHA256"), forkBlockNumber,
  origin: apiOrigin.origin, executionRpc: rpcOrigin.origin, chainId: 8453,
  walletProvider: "disposable local private-key wallet", walletAddress: account.address,
  modelRouting: process.env.AOMI_STABILITY_MODEL ?? "application default",
  applicationId: Number(process.env.AOMI_STABILITY_APPLICATION_ID ?? 8),
  resume: Boolean(process.env.AOMI_STABILITY_SESSION_ID && process.env.AOMI_STABILITY_COMMIT_ID),
}, null, 2) + "\n", { mode: 0o600 });
event("preflight", { chainId: 8453, walletAddress: account.address });

const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer, "local development issuer fixture missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const client = new AomiClient({
  baseUrl: apiOrigin.origin,
  guest: false,
  oauth: async ({ resource, scopes }) => {
    const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
      scope: "agent:read agent:write agent:actions:resolve pipeline:catalog pipeline:execute",
      resource, client_id: "commit-stability-wallet-e2e", auth_source: "oauth",
      principal_class: "user", grant_id: `commit-stability-${runId}`,
    });
    return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
  },
});

const sessionId = process.env.AOMI_STABILITY_SESSION_ID ?? `stability-${runId}`;
let commitId = process.env.AOMI_STABILITY_COMMIT_ID;
if (!commitId) {
  const prompt = `Send 0 ETH on chain 8453 from my connected wallet ${account.address} to the same address ${account.address}. Prepare and simulate the transaction, then commit the staged transaction in this turn. Do not request a different recipient or amount.`;
  const userState = { connection: { is_connected: true, provider: "e2e" }, evm: { address: account.address, chain_id: 8453, broadcaster: "wallet" } };
  event("agent_start", { sessionId });
  let page = await client.agent.start({
    sessionId, applicationId: Number(process.env.AOMI_STABILITY_APPLICATION_ID ?? 8),
    model: process.env.AOMI_STABILITY_MODEL, message: prompt, userState,
  }, { idempotencyKey: `start-${sessionId}` });
  const started = performance.now();
  while (performance.now() - started < 180_000) {
    for (const item of page.events) event("agent_event", { eventId: item.event_id, eventType: item.type, sequence: item.sequence });
    const pending = page.commits?.find((item) => item.action?.kind === "start_wallet_send" || item.action?.kind === "sign");
    if (pending) { commitId = pending.commit_id; break; }
    if (page.events.some((item) => item.type === "turn_state_changed" && ["complete", "failed", "interrupted"].includes(item.state))) break;
    page = await client.agent.poll(sessionId, { cursor: page.cursor, waitMs: 10_000 });
  }
  if (!commitId) {
    outcome.status = "BLOCKED";
    outcome.observed = "Agent turn did not expose a pending wallet commit within 180 seconds";
    await flush();
    console.log(JSON.stringify({ runId, evidence: output, status: outcome.status }));
    process.exit(2);
  }
}
assert.ok(commitId);
event("commit_discovered", { sessionId, commitId });
const recoveryFile = join(evidenceRoot, `recovery-${sessionId}-${commitId}.json`);
let recovery: { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true } | undefined;
try { recovery = JSON.parse(await readFile(recoveryFile, "utf8")); } catch { /* first attempt */ }
const session = new Session(client, {
  sessionId,
  commits: {
    recovery: {
      load: () => recovery,
      save: (_thread, _commit, record) => { recovery = record; writeFileSync(recoveryFile, JSON.stringify(record) + "\n", { mode: 0o600 }); },
      remove: () => { recovery = undefined; writeFileSync(recoveryFile, "{}\n", { mode: 0o600 }); },
    },
    async walletSendPreflight(view, payload) {
      assert.equal(view.chain_family, "evm");
      assert.equal(payload.chain_id, 8453);
      assert.equal(payload.signer.toLowerCase(), account.address.toLowerCase());
      assert.equal(payload.transaction.to.toLowerCase(), account.address.toLowerCase());
      assert.equal(BigInt(payload.transaction.value), 0n);
      assert.equal(payload.transaction.data, "0x");
      assert.ok(payload.transaction.gas_limit <= 50_000);
      assert.equal(await publicClient.getChainId(), 8453);
      event("wallet_preflight", { commitId: view.commit_id, signer: account.address, to: payload.transaction.to, valueWei: "0" });
    },
    async walletSend(view, payload) {
      event("wallet_invoked", { commitId: view.commit_id });
      const tx = payload.transaction;
      const hash = await walletClient.sendTransaction({
        account, chain: base, to: tx.to as `0x${string}`, value: 0n,
        data: "0x", gas: BigInt(tx.gas_limit), nonce: payload.nonce,
        maxFeePerGas: BigInt(tx.max_fee_per_gas), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
      });
      event("wallet_hash", { commitId: view.commit_id, hash });
      return hash;
    },
  },
});

try {
  const before = await session.commits.refresh(commitId);
  event("commit_before", { commitId, state: before.state, version: before.version, attemptId: before.wallet_attempt?.attempt_id });
  const after = await session.commits.execute(commitId);
  event("commit_after_execute", { commitId, state: after.state, version: after.version, attemptId: after.wallet_attempt?.attempt_id });
  const hash = after.transaction_id ?? recovery?.transactionId;
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("No wallet transaction hash observed");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 120_000 });
  const transaction = await publicClient.getTransaction({ hash: hash as `0x${string}` });
  assert.equal(receipt.status, "success");
  assert.equal(transaction.from.toLowerCase(), account.address.toLowerCase());
  assert.equal(transaction.to?.toLowerCase(), account.address.toLowerCase());
  assert.equal(transaction.value, 0n);
  assert.equal(transaction.input, "0x");
  event("receipt", { hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), status: receipt.status });
  let terminal = await session.commits.refresh(commitId);
  const waitStart = performance.now();
  while (performance.now() - waitStart < 120_000 && !["confirmed", "failed", "rejected", "expired"].includes(terminal.state)) {
    await new Promise((done) => setTimeout(done, 1000));
    terminal = await session.commits.refresh(commitId);
  }
  event("commit_terminal", { commitId, state: terminal.state, version: terminal.version });
  outcome.status = terminal.state === "confirmed" ? "PASS" : "FAIL";
  outcome.observed = `receipt success; commit ${terminal.state}`;
  outcome.sessionId = sessionId;
  outcome.commitId = commitId;
  outcome.transactionHash = hash;
  outcome.blockNumber = receipt.blockNumber.toString();
} catch (error) {
  outcome.status = "FAIL";
  const record = error as { code?: unknown; status?: unknown };
  outcome.observed = `${String(record.code ?? "error")} (${String(record.status ?? "n/a")})`;
  event("error", { code: String(record.code ?? "error"), status: record.status ?? null });
} finally {
  session.close();
  await flush();
}
console.log(JSON.stringify({ runId, evidence: output, status: outcome.status, sessionId, commitId }));
if (outcome.status !== "PASS") process.exitCode = 1;
