/** Execute a previously reviewed Agent approval/supply pair on a disposable local fork. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { mintAccountBearer, mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const required = (name: string) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
assert.equal(process.env.AOMI_STABILITY_EXECUTE, "1", "local send requires AOMI_STABILITY_EXECUTE=1");
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const agentOrigin = new URL(required("AOMI_STABILITY_ORIGIN"));
const commitOrigin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
const rpcOrigin = new URL(required("AOMI_STABILITY_LOCAL_RPC"));
for (const url of [agentOrigin, commitOrigin, rpcOrigin]) {
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "all origins must be loopback");
}
const keyFile = await realpath(required("AOMI_STABILITY_LOCAL_KEY_FILE"));
assert.notEqual(keyFile, "/home/aron/Documents/Work/Aomi/.env.key", "funded wallet forbidden on local fault chain");
const keyMatch = (await readFile(keyFile, "utf8")).match(/0x[\da-fA-F]{64}/);
assert.ok(keyMatch, "disposable key missing");
const account = privateKeyToAccount(keyMatch[0] as `0x${string}`);
const probeFile = resolve(required("AOMI_STABILITY_PAIR_PROBE_RESULT"));
const probe = JSON.parse(await readFile(probeFile, "utf8")) as {
  status: string; sessionId: string; commitIds?: string[]; batchId?: string;
};
assert.equal(probe.status, "PASS", "pair probe must validate the durable review first");
assert.ok(probe.batchId && probe.commitIds?.length === 2, "probe has no exact ordered batch");
const userId = required("AOMI_STABILITY_USER_ID");
const publicClient = createPublicClient({ chain: base, transport: http(rpcOrigin.href) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcOrigin.href) });
assert.equal(await publicClient.getChainId(), 8453);
const node = await fetch(rpcOrigin, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }), signal: AbortSignal.timeout(10_000) });
assert.ok(node.ok && (await node.json() as { result?: unknown }).result, "RPC must be local Anvil");

const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const pool = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" as const;
const aUsdc = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab" as const;
const amount = 10_000n;
const erc20 = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const aave = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);
const expected = [
  { to: usdc.toLowerCase(), data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, amount] }).toLowerCase(), maxGas: 100_000 },
  { to: pool.toLowerCase(), data: encodeFunctionData({ abi: aave, functionName: "supply", args: [usdc, amount, account.address, 0] }).toLowerCase(), maxGas: 500_000 },
];
const balances = async () => {
  const [usdcBalance, aUsdcBalance, allowance] = await Promise.all([
    publicClient.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [account.address], authorizationList: undefined }),
    publicClient.readContract({ address: aUsdc, abi: erc20, functionName: "balanceOf", args: [account.address], authorizationList: undefined }),
    publicClient.readContract({ address: usdc, abi: erc20, functionName: "allowance", args: [account.address, pool], authorizationList: undefined }),
  ]);
  return { usdcBalance, aUsdcBalance, allowance };
};
const beforeBalances = await balances();
assert.ok(beforeBalances.usdcBalance >= amount && beforeBalances.allowance < amount, "local fork balance/allowance precondition missing");

const runId = randomUUID();
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const frontendRoot = resolve(import.meta.dirname, "..");
const timeline: Record<string, unknown>[] = [];
const event = (phase: string, detail: Record<string, unknown> = {}) => timeline.push({ phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...detail });
const result: Record<string, unknown> = { runId, status: "BLOCKED", caseIds: ["S01", "P03", "W01", "C01", "C02", "C07"],
  sessionId: probe.sessionId, batchId: probe.batchId, commitIds: probe.commitIds, sends: 0 };
const flush = async () => {
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(out, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
};
await writeFile(join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, runId, at: new Date().toISOString(),
  scenario: "Agent durable approval/supply, 90-second inter-leg wait, local fork wallet",
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: revision(backendRoot), frontendRunnerRevision: revision(frontendRoot),
  databaseMigrationDigest: required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  managerRevision: required("AOMI_STABILITY_MANAGER_REVISION"), anvilBinarySha256: required("AOMI_STABILITY_ANVIL_SHA256"),
  agentOrigin: agentOrigin.origin, commitOrigin: commitOrigin.origin, executionRpc: rpcOrigin.origin,
  chainId: 8453, walletAddress: account.address, keyFileSha256: createHash("sha256").update(keyFile).digest("hex"),
  probeResult: probeFile, initialBlock: (await publicClient.getBlockNumber()).toString(), realBaseSends: 0,
  beforeBalances: Object.fromEntries(Object.entries(beforeBalances).map(([k, v]) => [k, v.toString()])),
}, null, 2) + "\n", { mode: 0o600 });

const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer, "local development issuer fixture missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const agentClient = new AomiClient({ baseUrl: agentOrigin.origin, guest: false,
  oauth: async ({ resource, scopes }) => {
    const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
      scope: "agent:read agent:write agent:actions:resolve", resource,
      client_id: "commit-stability-aave-execute", auth_source: "oauth", principal_class: "user", grant_id: `commit-stability-${runId}`,
    });
    return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
  },
});
const commitClient = new AomiClient({ baseUrl: commitOrigin.origin, guest: false,
  getAccountBearer: async () => (await mintAccountBearer(userId)).bearer });
const recoveryFile = join(out, "recovery.json");
const recovery: Record<string, { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true }> = {};
const session = new Session(commitClient, { sessionId: probe.sessionId, commits: {
  recovery: {
    load: (_thread, id) => recovery[id],
    save: (_thread, id, record) => { recovery[id] = record; writeFileSync(recoveryFile, JSON.stringify(recovery) + "\n", { mode: 0o600 }); },
    remove: (_thread, id) => { delete recovery[id]; writeFileSync(recoveryFile, JSON.stringify(recovery) + "\n", { mode: 0o600 }); },
  },
  async walletSendPreflight(view, payload) {
    const index = probe.commitIds?.indexOf(view.commit_id) ?? -1;
    assert.ok(index === 0 || index === 1, "unreviewed commit ID");
    assert.equal(view.batch?.batch_id, probe.batchId);
    assert.equal(view.batch?.index, index);
    assert.equal(view.chain_family, "evm");
    assert.equal(view.chain_ref, "8453");
    assert.equal(view.signer.toLowerCase(), account.address.toLowerCase());
    assert.equal(payload.chain_id, 8453);
    assert.equal(payload.signer.toLowerCase(), account.address.toLowerCase());
    assert.equal(payload.transaction.to.toLowerCase(), expected[index].to);
    assert.equal(payload.transaction.data.toLowerCase(), expected[index].data);
    assert.equal(BigInt(payload.transaction.value), 0n);
    assert.ok(payload.transaction.gas_limit > 0 && payload.transaction.gas_limit <= expected[index].maxGas);
    assert.equal(await publicClient.getChainId(), 8453);
    event("wallet_preflight", { commitId: view.commit_id, index, to: payload.transaction.to, calldataSha256: createHash("sha256").update(payload.transaction.data).digest("hex") });
  },
  async walletSend(view, payload) {
    const index = probe.commitIds?.indexOf(view.commit_id) ?? -1;
    assert.ok(index === 0 || index === 1);
    event("wallet_invoked", { commitId: view.commit_id, index });
    const tx = payload.transaction;
    const hash = await walletClient.sendTransaction({ account, chain: base, to: tx.to as `0x${string}`, value: 0n,
      data: tx.data as `0x${string}`, gas: BigInt(tx.gas_limit), nonce: payload.nonce,
      maxFeePerGas: BigInt(tx.max_fee_per_gas), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
    } as unknown as Parameters<typeof walletClient.sendTransaction>[0]);
    result.sends = Number(result.sends) + 1;
    event("wallet_hash", { commitId: view.commit_id, index, hash });
    return hash;
  },
} });

const controller = new AbortController();
let cursor: string | undefined;
let streamReadyResolve: (() => void) | undefined;
const streamReady = new Promise<void>((done) => { streamReadyResolve = done; });
const seen = new Set<string>();
const streamTask = (async () => {
  while (!controller.signal.aborted) {
    try {
      await agentClient.agent.stream(probe.sessionId, { cursor, signal: controller.signal }, (kind, frame) => {
        const receivedAt = new Date().toISOString();
        if (kind === "page") {
          const page = frame as { cursor?: string; events?: Array<{ event_id: string; type: string; sequence: number; state?: string }> };
          cursor = page.cursor ?? cursor;
          streamReadyResolve?.(); streamReadyResolve = undefined;
          for (const item of page.events ?? []) {
            if (seen.has(item.event_id)) continue;
            seen.add(item.event_id);
            event("live_event", { receivedAt, eventId: item.event_id, sequence: item.sequence, eventType: item.type, state: item.state ?? null });
          }
        } else if (kind === "message") {
          const item = frame as { turn_id?: string; revision?: number; message?: { message_key?: string; content?: string } };
          event("live_message", { receivedAt, turnId: item.turn_id, revision: item.revision, messageKey: item.message?.message_key,
            contentLength: item.message?.content?.length ?? 0 });
        } else event("stream_resync", { receivedAt });
      });
      if (!controller.signal.aborted) event("stream_reconnect", { cursor });
    } catch (error) {
      if (!controller.signal.aborted) event("stream_error", { name: (error as Error).name, cursor });
    }
    if (!controller.signal.aborted) await new Promise((done) => setTimeout(done, 150));
  }
})();

try {
  await Promise.race([streamReady, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("live stream did not yield initial page")), 10_000))]);
  event("stream_ready", { cursor });
  const initial = await Promise.all(probe.commitIds.map((id) => session.commits.refresh(id)));
  assert.deepEqual(initial.map((v) => v.commit_id), probe.commitIds);
  assert.ok(initial.every((v, i) => v.batch?.batch_id === probe.batchId && v.batch.index === i));
  assert.deepEqual(initial.map((v) => v.stage_id), initial[0].batch?.ordered_stage_ids);
  assert.ok(initial.every((v) => v.state === "needs_signature"), "both commits must be unsent before execution");
  for (const [index, id] of probe.commitIds.entries()) {
    if (index === 1) {
      event("second_leg_wait_start", { firstCommitId: probe.commitIds[0] });
      await new Promise((done) => setTimeout(done, 90_000));
      event("second_leg_wait_end", { secondCommitId: id });
    }
    const before = await session.commits.refresh(id);
    assert.equal(before.state, "needs_signature", "no auto-send occurred");
    const submitted = await session.commits.execute(id);
    const hash = submitted.transaction_id ?? recovery[id]?.transactionId;
    assert.match(hash ?? "", /^0x[\da-fA-F]{64}$/);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 120_000 });
    const transaction = await publicClient.getTransaction({ hash: hash as `0x${string}` });
    assert.equal(receipt.status, "success");
    assert.equal(transaction.from.toLowerCase(), account.address.toLowerCase());
    assert.equal(transaction.to?.toLowerCase(), expected[index].to);
    assert.equal(transaction.input.toLowerCase(), expected[index].data);
    assert.equal(transaction.value, 0n);
    event("receipt", { index, commitId: id, hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), status: receipt.status });
    let latest = await session.commits.refresh(id);
    const started = performance.now();
    while (performance.now() - started < 120_000 && !["confirmed", "failed", "rejected", "expired"].includes(latest.state)) {
      await new Promise((done) => setTimeout(done, 1000));
      latest = await session.commits.refresh(id);
    }
    assert.equal(latest.state, "confirmed", `commit ${index} did not confirm`);
    event("commit_confirmed", { index, commitId: id, version: latest.version, hash });
    const state = await balances();
    if (index === 0) {
      assert.equal(state.usdcBalance, beforeBalances.usdcBalance, "approval changed principal");
      assert.ok(state.allowance >= amount, "approval not effective");
    } else {
      assert.equal(state.usdcBalance, beforeBalances.usdcBalance - amount, "supply did not transfer exactly 0.01 USDC");
      assert.ok(state.aUsdcBalance >= beforeBalances.aUsdcBalance + amount, "aUSDC receipt balance did not increase");
    }
    event("chain_effect", { index, usdcBalance: state.usdcBalance.toString(), aUsdcBalance: state.aUsdcBalance.toString(), allowance: state.allowance.toString() });
  }
  const callbackStarted = performance.now();
  while (performance.now() - callbackStarted < 120_000 && !timeline.some((row) => row.phase === "live_event" && row.eventType === "turn_state_changed" && row.state === "complete")) {
    await new Promise((done) => setTimeout(done, 250));
  }
  const latestPage = await agentClient.agent.poll(probe.sessionId, { waitMs: 0 });
  const sawFinalLive = timeline.some((row) => row.phase === "live_event" && row.eventType === "turn_state_changed" && row.state === "complete");
  result.status = sawFinalLive ? "PASS" : "BLOCKED";
  result.observed = sawFinalLive
    ? "Exact Agent-reviewed approval/supply batch sent once per member on disposable local fork, with 90s inter-leg wait, both receipts confirmed, intended token effects verified, and live stream final completion received."
    : "Both exact fork transactions and effects verified, but live callback completion was not observed within 120s; inspect stream/cold readback before classifying callback.";
  result.finalEventTypes = latestPage.events.map((item) => item.type);
  result.liveEventCount = seen.size;
} catch (error) {
  const record = error as { name?: string; message?: string; code?: string };
  result.status = "FAIL";
  result.observed = `${record.code ?? record.name ?? "Error"}: ${String(record.message ?? "").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/0x[\da-fA-F]{64,}/g, "[redacted-hex]").slice(0, 260)}`;
  event("execution_error", { name: record.name ?? "Error", code: record.code ?? null });
} finally {
  controller.abort();
  await streamTask;
  session.close();
  await flush();
}
console.log(JSON.stringify({ runId, status: result.status, evidence: out, sessionId: probe.sessionId, commitIds: probe.commitIds }));
if (result.status !== "PASS") process.exitCode = 1;
