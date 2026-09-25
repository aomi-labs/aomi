/**
 * Deterministic no-send approval -> Aave supply probe through the public SDK.
 * It records S01/P03 preparation evidence; it never signs a wallet request.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient } from "../packages/client/src/index.ts";

const required = (name: string): string => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const apiOrigin = new URL(required("AOMI_STABILITY_ORIGIN"));
const rpcOrigin = new URL(required("AOMI_STABILITY_RPC"));
const evidenceRoot = resolve(required("AOMI_STABILITY_EVIDENCE"));
const userId = required("AOMI_STABILITY_USER_ID");
const wallet = required("AOMI_STABILITY_WALLET") as `0x${string}`;
assert.match(wallet, /^0x[\da-fA-F]{40}$/);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(apiOrigin.hostname), "API must be local");
assert.ok(["http:", "https:"].includes(rpcOrigin.protocol), "RPC must be HTTP(S)");
const amount = 10_000n; // 0.01 USDC; no wallet request is sent.
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const pool = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" as const;
const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const aave = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);
const hexResult = (value: unknown): `0x${string}` => {
  if (typeof value !== "string") throw new Error("invalid RPC hex result");
  assert.match(value, /^0x[\da-fA-F]+$/);
  return value as `0x${string}`;
};
const runId = randomUUID();
const output = join(evidenceRoot, runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const frontendRoot = resolve(import.meta.dirname, "..");
const timeline: Record<string, unknown>[] = [];
const mark = (phase: string, values: Record<string, unknown> = {}) => timeline.push({ phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...values });
const result: Record<string, unknown> = {
  runId, status: "BLOCKED", caseIds: ["S01", "P03"],
  wallet, chainId: 8453, amountBaseUnits: amount.toString(), sends: 0,
};
const save = async () => {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(output, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
};
const manifest = {
  schemaVersion: 1, runId, timestamp: new Date().toISOString(),
  backendRevision: process.env.AOMI_STABILITY_BACKEND_RUNTIME_REVISION ?? revision(backendRoot),
  frontendRevision: process.env.AOMI_STABILITY_FRONTEND_RUNTIME_REVISION ?? revision(frontendRoot),
  runnerRevision: revision(frontendRoot),
  apiOrigin: apiOrigin.origin, chainId: 8453, forkOrUpstreamBlock: null as string | null,
  wallet, modelRouting: "none", sendsAuthorizedByRunner: false,
};
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
let balance: bigint;
let allowance: bigint;
let blockNumber: bigint;
try {
  const chain = createPublicClient({ chain: base, transport: http(rpcOrigin.href) });
  assert.equal(await chain.getChainId(), 8453, "execution chain must be Base ID 8453");
  const [balanceData, allowanceData, block] = await Promise.all([
    chain.request({ method: "eth_call", params: [{ to: usdc, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [wallet] }) }, "latest"] }),
    chain.request({ method: "eth_call", params: [{ to: usdc, data: encodeFunctionData({ abi: erc20, functionName: "allowance", args: [wallet, pool] }) }, "latest"] }),
    chain.getBlockNumber(),
  ]);
  balance = decodeFunctionResult({ abi: erc20, functionName: "balanceOf", data: hexResult(balanceData) });
  allowance = decodeFunctionResult({ abi: erc20, functionName: "allowance", data: hexResult(allowanceData) });
  blockNumber = block;
  manifest.forkOrUpstreamBlock = blockNumber.toString();
  result.blockNumber = blockNumber.toString();
  result.initialAllowance = allowance.toString();
  result.initialBalance = balance.toString();
  assert.ok(balance >= amount, "wallet needs at least 0.01 USDC for the supply simulation");
  mark("preflight", { chainId: 8453, blockNumber: blockNumber.toString() });
} catch (error) {
  result.observed = `preflight failed: ${error instanceof Error ? error.name : "error"}`;
  mark("preflight_error");
  await save();
  console.log(JSON.stringify({ runId, status: result.status, evidence: output }));
  process.exit(2);
}
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });

try {
  const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
    .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
  assert.ok(issuer, "local development issuer fixture missing");
  process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
  const client = new AomiClient({
    baseUrl: apiOrigin.origin, guest: false,
    oauth: async ({ resource, scopes }) => {
      const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
        scope: "pipeline:catalog pipeline:execute", resource,
        client_id: "commit-stability-aave-e2e", auth_source: "oauth",
        principal_class: "user", grant_id: `commit-stability-${runId}`,
      });
      return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
    },
  });
  const actions = [
    {
      to: usdc, chain_id: 8453, value: "0", gas_limit: "80000", protocol: "aave",
      description: "Approve 0.01 USDC for Aave Pool",
      data: { signature: "approve(address,uint256)", args: [pool, amount.toString()], raw: encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, amount] }) },
    },
    {
      to: pool, chain_id: 8453, value: "0", gas_limit: "350000", protocol: "aave",
      description: "Supply 0.01 USDC to Aave",
      data: { signature: "supply(address,uint256,address,uint16)", args: [usdc, amount.toString(), wallet, "0"], raw: encodeFunctionData({ abi: aave, functionName: "supply", args: [usdc, amount, wallet, 0] }) },
    },
  ];
  mark("stage_start");
  const staged = await client.pipeline.evm.stage({ actions }, { idempotencyKey: `${runId}-stage` });
  assert.equal(staged.actions.length, 2);
  const stagedIds = staged.actions.map((action) => action.pending_tx_id);
  const stagedOrder = staged.actions.map((action) => `${action.to.toLowerCase()}:${action.data.toLowerCase()}`);
  mark("stage_end", { ids: stagedIds, digest: staged.digest });
  const simulated = await client.pipeline.evm.simulate(staged, { idempotencyKey: `${runId}-simulate` });
  assert.deepEqual(simulated.actions.map((action) => action.pending_tx_id), stagedIds);
  assert.deepEqual(simulated.actions.map((action) => `${action.to.toLowerCase()}:${action.data.toLowerCase()}`), stagedOrder);
  assert.equal(simulated.digest, staged.digest);
  assert.equal(simulated.simulation.status, "passed", "ordered approval and supply must simulate successfully");
  assert.ok(simulated.simulation.guards.every((guard) => guard.status !== "failed"), "failed simulation guard");
  mark("simulate_end", { status: simulated.simulation.status, digest: simulated.digest });
  result.cases = {
    P03: allowance < amount ? "PASS" : "BLOCKED: preexisting allowance; dependent-leg simulation not established",
    S01: "BLOCKED: commit preparation and chain effects not yet observed",
  };
  const reloaded = new AomiClient({
    baseUrl: apiOrigin.origin, guest: false,
    oauth: async ({ resource, scopes }) => {
      const { bearer, expiresAt } = await mintAgentApiBearer(userId, {
        scope: "pipeline:catalog pipeline:execute", resource,
        client_id: "commit-stability-aave-e2e", auth_source: "oauth",
        principal_class: "user", grant_id: `commit-stability-${runId}`,
      });
      return { accessToken: bearer, expiresAt: expiresAt * 1000, resource, scopes, tokenType: "Bearer" as const };
    },
  });
  const committed = await reloaded.pipeline.evm.commit(simulated, { idempotencyKey: `${runId}-commit` });
  assert.equal(committed.digest, staged.digest);
  assert.equal(committed.requests.length, 1);
  const request = committed.requests[0];
  assert.equal(request.type, "execute_evm");
  if (request.type !== "execute_evm") throw new Error("expected an EVM wallet request");
  assert.equal(request.transactions.length, 2);
  assert.deepEqual(request.transactions.map((tx) => `${tx.to.toLowerCase()}:${tx.data.toLowerCase()}`), stagedOrder);
  mark("commit_prepared", { digest: committed.digest, walletRequests: committed.requests.length, transactions: request.transactions.length });
  result.status = "PASS";
  result.observed = "ordered approval and supply preserved action order/digest through reload and commit preparation; no wallet send";
  result.stagedIds = stagedIds;
  result.digest = staged.digest;
  result.preparedWalletRequests = committed.requests.length;
  result.preparedTransactions = request.transactions.length;
  result.cases = {
    S01: "BLOCKED: this no-send direct Pipeline probe cannot prove chain effects",
    P03: allowance < amount ? "PASS" : "BLOCKED: preexisting allowance; dependent-leg simulation not established",
  };
} catch (error) {
  const record = error as { code?: unknown; status?: unknown };
  result.status = "FAIL";
  result.observed = `${String(record.code ?? "error")} (${String(record.status ?? "n/a")})`;
  result.cases = timeline.some((row) => row.phase === "simulate_end")
    ? { P03: allowance < amount ? "PASS" : "BLOCKED: preexisting allowance", S01: "FAIL: commit preparation rejected" }
    : { P03: "FAIL: ordered simulation did not pass", S01: "BLOCKED: no prepared commit" };
  mark("error", { code: String(record.code ?? "error"), status: record.status ?? null });
} finally {
  await save();
}
console.log(JSON.stringify({ runId, status: result.status, evidence: output }));
if (result.status !== "PASS") process.exitCode = 1;
