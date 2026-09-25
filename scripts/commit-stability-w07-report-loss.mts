/** Fail a known-hash report before it reaches Commit Service, then recover after SDK reload. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { mintAccountBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const required = (name: string) => { const value = process.env[name]; assert.ok(value, `${name} is required`); return value; };
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const origin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
const rpc = new URL(required("AOMI_STABILITY_LOCAL_RPC"));
assert.ok([origin, rpc].every((url) => ["127.0.0.1", "localhost", "::1"].includes(url.hostname)));
const keyFile = await realpath(required("AOMI_STABILITY_LOCAL_KEY_FILE"));
assert.notEqual(keyFile, "/home/aron/Documents/Work/Aomi/.env.key");
const key = (await readFile(keyFile, "utf8")).match(/0x[0-9a-fA-F]{64}/)?.[0];
assert.ok(key);
const account = privateKeyToAccount(key as `0x${string}`);
assert.equal(account.address.toLowerCase(), required("AOMI_STABILITY_LOCAL_WALLET_ADDRESS").toLowerCase());
const prepPath = resolve(required("AOMI_STABILITY_PREP_RESULT"));
const prep = JSON.parse(await readFile(prepPath, "utf8")) as { status: string; sessionId: string; commitId: string; account: string };
assert.equal(prep.status, "PASS");
assert.equal(prep.account.toLowerCase(), account.address.toLowerCase());
const chain = createPublicClient({ chain: base, transport: http(rpc.href) });
const wallet = createWalletClient({ account, chain: base, transport: http(rpc.href) });
assert.equal(await chain.getChainId(), 8453);
const info = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }) });
assert.ok(info.ok && (await info.json() as { result?: unknown }).result);
const runId = randomUUID();
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const rev = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
await writeFile(join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, runId, at: new Date().toISOString(),
  scenario: "W07 known hash, one pre-server report failure, fresh SDK recovery",
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: rev(backendRoot), frontendRunnerRevision: rev(resolve(import.meta.dirname, "..")),
  databaseMigrationDigest: required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  prepPath, sessionId: prep.sessionId, commitId: prep.commitId, wallet: account.address,
  commitOrigin: origin.origin, executionRpc: rpc.origin, chainId: 8453, realBaseSends: 0 }, null, 2) + "\n", { mode: 0o600 });
const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer);
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const userId = required("AOMI_STABILITY_USER_ID");
const createClient = () => new AomiClient({ baseUrl: origin.origin, guest: false,
  getAccountBearer: async () => (await mintAccountBearer(userId)).bearer });
const recoveryPath = join(out, "recovery.json");
type Recovery = { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true };
const recovery = { load: (_thread: string, id: string): Recovery | undefined => {
  try { return (JSON.parse(readFileSync(recoveryPath, "utf8")) as Record<string, Recovery>)[id]; } catch { return undefined; }
}, save: (_thread: string, id: string, record: Recovery) => {
  writeFileSync(recoveryPath, JSON.stringify({ [id]: record }) + "\n", { mode: 0o600 });
}, remove: (_thread: string, _id: string) => {
  writeFileSync(recoveryPath, "{}\n", { mode: 0o600 });
} };
let walletInvocations = 0;
const capabilities = { recovery,
  walletSendPreflight: async (view: { signer: string }, payload: { chain_id: number; transaction: { to: string; value: string; data: string; gas_limit: number } }) => {
    assert.equal(view.signer.toLowerCase(), account.address.toLowerCase());
    assert.equal(payload.chain_id, 8453);
    assert.equal(payload.transaction.to.toLowerCase(), account.address.toLowerCase());
    assert.equal(BigInt(payload.transaction.value), 0n);
    assert.equal(payload.transaction.data, "0x");
    assert.ok(payload.transaction.gas_limit <= 50_000);
  },
  walletSend: async (_view: unknown, payload: { transaction: { to: string; value: string; data: string; gas_limit: number;
    max_fee_per_gas: string; max_priority_fee_per_gas: string }; nonce: number }) => {
    walletInvocations++;
    assert.equal(walletInvocations, 1, "no second wallet invocation");
    const tx = payload.transaction;
    return wallet.sendTransaction({ account, chain: base, to: tx.to.toLowerCase() as `0x${string}`,
      value: 0n, data: "0x", gas: BigInt(tx.gas_limit), nonce: payload.nonce,
      maxFeePerGas: BigInt(tx.max_fee_per_gas), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas) });
  } };
const result: Record<string, unknown> = { runId, status: "BLOCKED", caseId: "W07", sessionId: prep.sessionId,
  commitId: prep.commitId, walletInvocations: 0 };
const firstClient = createClient();
const original = firstClient.request.bind(firstClient);
let injected = false;
firstClient.request = (async (method, path, options) => {
  if (!injected && method === "POST" && /\/wallet-attempts\/[^/]+\/report$/.test(path)) {
    injected = true;
    throw new Error("injected_report_POST_failure_before_server_write");
  }
  return original(method, path, options);
}) as typeof firstClient.request;
const first = new Session(firstClient, { sessionId: prep.sessionId, commits: capabilities });
try {
  const before = await first.commits.refresh(prep.commitId);
  assert.equal(before.state, "needs_signature");
  await assert.rejects(first.commits.execute(prep.commitId), /injected_report_POST_failure_before_server_write/);
  assert.equal(injected, true);
  const saved = recovery.load(prep.sessionId, prep.commitId);
  assert.ok(saved?.attemptId && saved.transactionId, "hash and attempt must be saved before failed report");
  assert.equal(walletInvocations, 1);
  const receipt = await chain.waitForTransactionReceipt({ hash: saved.transactionId as `0x${string}`, timeout: 60_000 });
  assert.equal(receipt.status, "success");
  first.close();
  const secondClient = createClient();
  const second = new Session(secondClient, { sessionId: prep.sessionId, commits: capabilities });
  try {
    const pending = await second.commits.refresh(prep.commitId);
    assert.equal(pending.wallet_attempt?.attempt_id, saved.attemptId);
    const submitted = await second.commits.execute(prep.commitId);
    assert.equal(submitted.transaction_id?.toLowerCase(), saved.transactionId.toLowerCase());
    assert.equal(walletInvocations, 1);
    const replay = await secondClient.request<{ commit_id: string; transaction_id: string }>("POST",
      `/api/commits/${prep.commitId}/wallet-attempts/${saved.attemptId}/report`,
      { sessionId: prep.sessionId, body: { kind: "transaction", transaction_id: saved.transactionId } });
    assert.equal(replay.commit_id, prep.commitId);
    assert.equal(replay.transaction_id?.toLowerCase(), saved.transactionId.toLowerCase());
    let final = await second.commits.refresh(prep.commitId);
    const waitStart = performance.now();
    while (performance.now() - waitStart < 60_000 && final.state !== "confirmed") {
      await new Promise((done) => setTimeout(done, 500));
      final = await second.commits.refresh(prep.commitId);
    }
    assert.equal(final.state, "confirmed");
    assert.equal(walletInvocations, 1);
    result.status = "PASS";
    result.observed = "One exact local-fork wallet send returned a known hash, saved with the durable attempt. The first report failed before server write; a fresh SDK session reported the same hash, explicit replay was idempotent, and the receipt confirmed without another wallet invocation.";
    result.attemptId = saved.attemptId;
    result.transactionHash = saved.transactionId;
    result.blockNumber = receipt.blockNumber.toString();
    result.finalState = final.state;
    result.reportReplay = "same hash and attempt";
  } finally { second.close(); }
} catch (error) {
  result.status = "FAIL";
  result.observed = `${(error as Error).name}: ${(error as Error).message}`.slice(0, 260);
  result.injected = injected;
} finally {
  first.close();
  result.walletInvocations = walletInvocations;
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ runId, status: result.status, evidence: out }));
if (result.status !== "PASS") process.exitCode = 1;
