/** Fund only a disposable wallet on a loopback Anvil Base fork. No key is read. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const required = (name: string): string => {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
};
const rpcUrl = new URL(required("AOMI_STABILITY_LOCAL_RPC"));
assert.ok(["127.0.0.1", "localhost", "::1"].includes(rpcUrl.hostname), "fork RPC must be loopback");
const evidenceRoot = resolve(required("AOMI_STABILITY_EVIDENCE"));
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const disposable = required("AOMI_STABILITY_WALLET") as `0x${string}`;
const source = "0x28581d8065dA7e25710F25F9DD30F9d361757A7D" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
assert.match(disposable, /^0x[\da-fA-F]{40}$/);
assert.notEqual(disposable.toLowerCase(), source.toLowerCase(), "disposable wallet must differ from funded source");
const amount = 30_000n; // 0.03 USDC in the fork only.
const erc20 = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const runId = randomUUID();
const output = join(evidenceRoot, runId);
await mkdir(output, { recursive: true, mode: 0o700 });
const revision = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const result: Record<string, unknown> = {
  runId, status: "BLOCKED", chainId: 8453, source, disposable,
  amountBaseUnits: amount.toString(), location: "loopback Anvil fork only",
};
const timeline: Record<string, unknown>[] = [];
const mark = (phase: string, detail: Record<string, unknown> = {}) => timeline.push({ phase, at: new Date().toISOString(), monotonicMs: performance.now(), ...detail });
const flush = async () => {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(output, "timeline.jsonl"), timeline.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
};
await writeFile(join(output, "manifest.json"), JSON.stringify({
  schemaVersion: 1, runId, timestamp: new Date().toISOString(),
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  runnerRevision: revision(resolve(import.meta.dirname, "..")),
  backendSourceRevision: revision(backendRoot),
  executionRpc: rpcUrl.origin, chainId: 8453, walletProvider: "Anvil impersonation fixture",
  realBaseSends: 0,
}, null, 2) + "\n", { mode: 0o600 });
let rpcId = 0;
const rpc = async (method: string, params: unknown[] = []): Promise<unknown> => {
  const response = await fetch(rpcUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: { code?: number } };
  if (body.error || body.result === undefined) throw new Error(`RPC ${method} failed (${body.error?.code ?? "missing result"})`);
  return body.result;
};
const hex = (value: unknown): `0x${string}` => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]+$/.test(value)) throw new Error("invalid RPC hex result");
  return value as `0x${string}`;
};
const balance = async (address: `0x${string}`): Promise<bigint> => {
  const data = encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [address] });
  const response = hex(await rpc("eth_call", [{ to: usdc, data }, "latest"]));
  return decodeFunctionResult({ abi: erc20, functionName: "balanceOf", data: response });
};

try {
  assert.equal(Number(BigInt(hex(await rpc("eth_chainId")))), 8453);
  await rpc("anvil_nodeInfo"); // Refuse a live Base endpoint before any mutation.
  const block = BigInt(hex(await rpc("eth_blockNumber")));
  const [sourceBefore, disposableBefore] = await Promise.all([balance(source), balance(disposable)]);
  assert.ok(sourceBefore >= amount, "forked source wallet lacks fixture USDC");
  mark("preflight", { forkBlock: block.toString(), sourceBalance: sourceBefore.toString(), disposableBalance: disposableBefore.toString() });
  await rpc("anvil_setBalance", [source, "0x2386f26fc10000"]); // 0.01 local ETH for gas.
  await rpc("anvil_setBalance", [disposable, "0x2386f26fc10000"]);
  await rpc("anvil_impersonateAccount", [source]);
  let hash: `0x${string}`;
  try {
    hash = hex(await rpc("eth_sendTransaction", [{
      from: source, to: usdc, value: "0x0", gas: "0x186a0",
      data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [disposable, amount] }),
    }]));
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [source]);
  }
  mark("fork_transfer_sent", { hash });
  let receipt: { status?: string; blockNumber?: string } | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    receipt = await rpc("eth_getTransactionReceipt", [hash]) as typeof receipt;
    if (receipt) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  assert.ok(receipt, "fork fixture transaction receipt timed out");
  assert.equal(receipt.status, "0x1", "fork transfer reverted");
  const [sourceAfter, disposableAfter] = await Promise.all([balance(source), balance(disposable)]);
  assert.equal(sourceBefore - sourceAfter, amount);
  assert.equal(disposableAfter - disposableBefore, amount);
  mark("fork_receipt", { hash, blockNumber: receipt.blockNumber, sourceAfter: sourceAfter.toString(), disposableAfter: disposableAfter.toString() });
  result.status = "PASS";
  result.forkBlock = block.toString();
  result.transactionHash = hash;
  result.disposableBalance = disposableAfter.toString();
} catch (error) {
  result.status = "FAIL";
  result.observed = error instanceof Error ? error.name : "error";
  mark("fixture_error");
} finally {
  await flush();
}
console.log(JSON.stringify({ runId, status: result.status, evidence: output }));
if (result.status !== "PASS") process.exitCode = 1;
