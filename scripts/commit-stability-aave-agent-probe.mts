/** Ask the real Agent to stage the exact 0.01 USDC approval/supply pair; never send. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
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
const wallet = required("AOMI_STABILITY_WALLET") as `0x${string}`;
assert.match(wallet, /^0x[\da-fA-F]{40}$/);
const model = process.env.AOMI_STABILITY_MODEL ?? "gpt-6-luna";
const applicationId = Number(process.env.AOMI_STABILITY_APPLICATION_ID ?? 8);
const amount = 10_000n;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const pool = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" as const;
const erc20 = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const aave = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);
const expected = [
  { to: usdc.toLowerCase(), data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, amount] }).toLowerCase(), gasMax: 100_000 },
  { to: pool.toLowerCase(), data: encodeFunctionData({ abi: aave, functionName: "supply", args: [usdc, amount, wallet, 0] }).toLowerCase(), gasMax: 500_000 },
];
const runId = randomUUID();
const sessionId = process.env.AOMI_STABILITY_SESSION_ID ?? `stability-aave-${runId}`;
const resume = Boolean(process.env.AOMI_STABILITY_SESSION_ID);
const output = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const manifest = {
  schemaVersion: 1, runId, sessionId, resume, timestamp: new Date().toISOString(),
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: revision(backendRoot),
  frontendRunnerRevision: revision(resolve(import.meta.dirname, "..")),
  databaseMigrationDigest: required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  managerRevision: required("AOMI_STABILITY_MANAGER_REVISION"),
  anvilBinarySha256: required("AOMI_STABILITY_ANVIL_SHA256"),
  agentOrigin: agentOrigin.origin, commitOrigin: commitOrigin.origin,
  executionRpc: rpcOrigin.origin, wallet, chainId: 8453, model, applicationId,
  amountBaseUnits: amount.toString(), realBaseSends: 0, localForkSends: 0,
};
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
const result: Record<string, unknown> = { runId, sessionId, status: "BLOCKED", caseIds: ["S01", "P03"], sends: 0 };
const timeline: Record<string, unknown>[] = [];
const event = (phase: string, detail: Record<string, unknown> = {}) => timeline.push({ phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...detail });
const save = async () => {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(output, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
};

try {
  const chain = createPublicClient({ chain: base, transport: http(rpcOrigin.href) });
  assert.equal(await chain.getChainId(), 8453);
  const node = await fetch(rpcOrigin, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }), signal: AbortSignal.timeout(10_000) });
  assert.ok(node.ok && (await node.json() as { result?: unknown }).result, "execution RPC must be Anvil");
  const [balance, allowance, block] = await Promise.all([
    chain.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [wallet], authorizationList: undefined }),
    chain.readContract({ address: usdc, abi: erc20, functionName: "allowance", args: [wallet, pool], authorizationList: undefined }),
    chain.getBlockNumber(),
  ]);
  assert.ok(balance >= amount, "disposable fork wallet lacks 0.01 USDC");
  assert.ok(allowance < amount, "existing allowance makes approval dependency ambiguous");
  event("fork_preflight", { blockNumber: block.toString(), balance: balance.toString(), allowance: allowance.toString() });

  const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
    .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
  assert.ok(issuer, "local development issuer fixture missing");
  process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
  const agentClient = new AomiClient({
    baseUrl: agentOrigin.origin, guest: false,
    oauth: async ({ resource, scopes }) => {
      const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
        scope: "agent:read agent:write agent:actions:resolve", resource,
        client_id: "commit-stability-aave-agent-probe", auth_source: "oauth",
        principal_class: "user", grant_id: `commit-stability-${runId}`,
      });
      return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
    },
  });
  const commitClient = new AomiClient({
    baseUrl: commitOrigin.origin, guest: false,
    getAccountBearer: async () => (await mintAccountBearer(userId)).bearer,
  });
  const prompt = `On Base chain 8453, from my connected wallet ${wallet}, prepare exactly these two transactions in order for me to approve: (1) call USDC ${usdc} approve(spender=${pool}, amount=10000 base units); (2) call Aave Pool ${pool} supply(asset=${usdc}, amount=10000 base units, onBehalfOf=${wallet}, referralCode=0). Both native values are zero. Stage, simulate the ordered pair, and commit the already staged pair as one batch. Do not stage a replacement pair, change the amount, execute anything else, or claim the wallet has sent them.`;
  const userState = { connection: { is_connected: true, provider: "e2e" }, evm: { address: wallet, chain_id: 8453, broadcaster: "wallet" as const } };
  let page = resume
    ? await agentClient.agent.poll(sessionId, { waitMs: 0 })
    : await agentClient.agent.start({ sessionId, applicationId, model, message: prompt, userState }, { idempotencyKey: `start-${sessionId}` });
  event(resume ? "agent_resume" : "agent_start", { sessionId });
  const commits = new Map<string, NonNullable<(typeof page.commits)>[number]>();
  const started = performance.now();
  while (performance.now() - started < 180_000) {
    for (const item of page.commits ?? []) commits.set(item.commit_id, item);
    for (const item of page.events) event("agent_event", { eventId: item.event_id, eventType: item.type, sequence: item.sequence });
    if (commits.size >= 2) break;
    if (page.events.some((item) => item.type === "turn_state_changed" && ["complete", "failed", "interrupted"].includes(item.state))) break;
    page = await agentClient.agent.poll(sessionId, { cursor: page.cursor, waitMs: 10_000 });
  }
  result.commitIds = [...commits.keys()];
  if (commits.size !== 2) {
    result.observed = `Agent exposed ${commits.size} wallet commits, expected exactly two`;
  } else {
    const session = new Session(commitClient, { sessionId });
    try {
      const views = await Promise.all([...commits.keys()].map((id) => session.commits.refresh(id)));
      views.sort((a, b) => (a.batch?.index ?? 0) - (b.batch?.index ?? 0));
      const batchId = views[0].batch?.batch_id;
      assert.ok(batchId && views[1].batch?.batch_id === batchId, "commits must belong to one durable batch");
      assert.deepEqual(views.map((v) => v.commit_id), views[0].batch?.ordered_commit_ids);
      assert.deepEqual(views.map((v) => v.stage_id), views[0].batch?.ordered_stage_ids);
      assert.deepEqual(views.map((v) => v.signer.toLowerCase()), [wallet.toLowerCase(), wallet.toLowerCase()]);
      assert.ok(views.every((v) => v.chain_family === "evm" && v.chain_ref === "8453" && v.broadcaster === "wallet"));
      const review = views[0].review;
      assert.ok(review && review.digest === views[1].review?.digest && review.legs.length === 2, "both members must share the exact two-leg review");
      for (const [index, leg] of review.legs.entries()) {
        assert.equal(leg.type, "execute_evm");
        assert.equal(leg.transactions.length, 1);
        const tx = leg.transactions[0];
        assert.equal(tx.chain_id, 8453);
        assert.equal(tx.from.toLowerCase(), wallet.toLowerCase());
        assert.equal(tx.to.toLowerCase(), expected[index].to);
        assert.equal(tx.data.toLowerCase(), expected[index].data);
        assert.equal(BigInt(tx.value ?? "0"), 0n);
      }
      assert.ok(views[0].action?.kind === "sign" || views[0].action?.kind === "start_wallet_send", "first member must be ready for explicit wallet approval");
      for (const [index, view] of views.entries()) {
        const action = view.action;
        if ((action?.kind === "sign" || action?.kind === "start_wallet_send") && action.payload.kind === "evm_transaction") {
          const tx = action.payload.transaction;
          assert.equal(tx.to.toLowerCase(), expected[index].to);
          assert.equal(tx.data.toLowerCase(), expected[index].data);
          assert.equal(BigInt(tx.value), 0n);
          assert.ok(tx.gas_limit <= expected[index].gasMax);
        }
      }
      event("durable_pair", { batchId, commitIds: views.map((v) => v.commit_id), stageIds: views.map((v) => v.stage_id), states: views.map((v) => v.state) });
      result.status = "PASS";
      result.observed = "Agent created one durable ordered two-commit batch; no wallet send. Deferred member payload is rechecked immediately before any later wallet invocation.";
      result.batchId = batchId;
      result.commitIds = views.map((v) => v.commit_id);
      result.stageIds = views.map((v) => v.stage_id);
      result.states = views.map((v) => v.state);
    } finally {
      session.close();
    }
  }
} catch (error) {
  const record = error as { name?: string; message?: string };
  result.status = "FAIL";
  result.observed = `${record.name ?? "Error"}: ${String(record.message ?? "").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 250)}`;
  event("probe_error", { name: record.name ?? "Error" });
} finally {
  await save();
}
console.log(JSON.stringify({ runId, status: result.status, evidence: output, sessionId }));
if (result.status !== "PASS") process.exitCode = 1;
