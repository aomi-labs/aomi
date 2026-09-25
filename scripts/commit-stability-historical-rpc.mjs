/** Read-only replay of the historical Base withdrawal fixture. Never signs or sends. */
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const secretFile = resolve(process.env.AOMI_STABILITY_PROVIDER_ENV ?? "");
const evidenceRoot = resolve(process.env.AOMI_STABILITY_EVIDENCE ?? "");
assert.ok(secretFile !== resolve(".") && evidenceRoot !== resolve("."), "provider env and evidence root required");
const envText = await readFile(secretFile, "utf8");
const line = envText.split(/\r?\n/).find((part) => /^ALCHEMY_API_KEY\s*=/.test(part));
assert.ok(line, "private provider key missing");
const key = line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
assert.ok(/^[A-Za-z0-9_-]+$/.test(key), "provider key format unexpected");
const provider = `https://base-mainnet.g.alchemy.com/v2/${key}`;
const runId = randomUUID();
const out = join(evidenceRoot, runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const from = "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0";
const to = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
const data = "0x69328dec000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000002710000000000000000000000000da65d415cc9d5ddc2a08bdffc996750755fc3cf0";
const tx = { from, to, data, value: "0x0" };
const balanceOverride = { [from]: { balance: "0x" + (1000n * 10n ** 18n).toString(16) } };
const checks = [
  ["eth_call", [tx, "0x3161a9a"], "historical_no_override"],
  ["eth_estimateGas", [tx, "0x3161a9a"], "historical_no_override"],
  ["eth_call", [tx, "0x3161a9a", balanceOverride], "historical_1000_eth_override"],
  ["eth_estimateGas", [tx, "0x3161a9a", balanceOverride], "historical_1000_eth_override"],
  ["eth_estimateGas", [tx, "0x3161acc"], "later_no_override"],
];
const rows = [];
for (let index = 0; index < checks.length; index++) {
  const [method, params, context] = checks[index];
  const started = performance.now();
  try {
    const response = await fetch(provider, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: index + 1, method, params }), signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    rows.push({ method, blockTag: params[1], context, httpStatus: response.status, durationMs: Math.round(performance.now() - started),
      result: body.result ?? null, rpcError: body.error ? { code: body.error.code, message: String(body.error.message).slice(0, 180) } : null });
  } catch (error) {
    rows.push({ method, blockTag: params[1], context, durationMs: Math.round(performance.now() - started), transportError: error?.name ?? "Error" });
  }
}
const manifest = { schemaVersion: 1, runId, at: new Date().toISOString(), providerAlias: "configured-alchemy-base-mainnet", chainId: 8453,
  historicalThreadId: "c4022468-068e-48dc-8266-e1fa615d7ba5", sender: from, target: to, nativeValue: "0x0",
  calldataSelector: data.slice(0, 10), calldataSha256: createHash("sha256").update(data).digest("hex"),
  calldata: data, amountBaseUnits: "10000", originalSimulationGas: 177491, originalFailure: "EVM panic 0x11 during preparation",
  override: "1000 ETH native balance for historical replay variants", originalWalletSends: 0 };
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
await writeFile(join(out, "rpc-results.json"), JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ runId, evidence: out, outcomes: rows.map((row) => ({ context: row.context, method: row.method, result: row.result ?? row.rpcError?.code ?? row.transportError })) }));
