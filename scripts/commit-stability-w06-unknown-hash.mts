/** Broadcast once, lose the wallet provider's hash response, and verify safe SDK reload. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { mintAccountBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session, normalizeEvmWalletTarget } from "../packages/client/src/index.ts";

const required = (name: string) => { const value = process.env[name]; assert.ok(value, `${name} is required`); return value; };
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const origin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
const rpc = new URL(required("AOMI_STABILITY_LOCAL_RPC"));
assert.ok([origin, rpc].every((url) => ["127.0.0.1", "localhost", "::1"].includes(url.hostname)));
const keyFile = resolve(required("AOMI_STABILITY_LOCAL_KEY_FILE"));
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
const nodeInfo = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_nodeInfo", params: [] }) });
assert.ok(nodeInfo.ok && (await nodeInfo.json() as { result?: unknown }).result);
const initialNonce = await chain.getTransactionCount({ address: account.address });
assert.equal(initialNonce, 0, "W06 requires a fresh disposable signer with no nonce history");
const runId = randomUUID();
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const rev = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
await writeFile(join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, runId, at: new Date().toISOString(),
  scenario: "W06 provider broadcasts once but loses hash response",
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
type Recovery = { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true };
const saved = new Map<string, Recovery>();
const recovery = { load: (_thread: string, id: string) => saved.get(id),
  save: (_thread: string, id: string, value: Recovery) => { saved.set(id, value); },
  remove: (_thread: string, id: string) => { saved.delete(id); } };
let walletInvocations = 0;
let observerHash: `0x${string}` | undefined;
const capabilities = { recovery,
  walletSendPreflight: async (view: { signer: string }, payload: { chain_id: number; transaction: { to: string; value: string; data: string; gas_limit: number } }) => {
    assert.equal(view.signer.toLowerCase(), account.address.toLowerCase());
    assert.equal(payload.chain_id, 8453);
    assert.equal(payload.transaction.to.toLowerCase(), account.address.toLowerCase());
    assert.equal(BigInt(payload.transaction.value), 0n);
    assert.equal(payload.transaction.data, "0x");
    assert.ok(payload.transaction.gas_limit <= 50_000);
  },
  walletSend: async (_view: unknown, payload: { transaction: { to: string; gas_limit: number; max_fee_per_gas: string; max_priority_fee_per_gas: string }; nonce: number }) => {
    walletInvocations++;
    assert.equal(walletInvocations, 1, "unknown outcome must never invoke wallet again");
    const tx = payload.transaction;
    observerHash = await wallet.sendTransaction({ account, chain: base, to: normalizeEvmWalletTarget(tx.to),
      value: 0n, data: "0x", gas: BigInt(tx.gas_limit), nonce: payload.nonce,
      maxFeePerGas: BigInt(tx.max_fee_per_gas), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas) });
    throw new Error("injected_provider_response_loss_after_broadcast");
  } };
const result: Record<string, unknown> = { runId, status: "BLOCKED", caseId: "W06", sessionId: prep.sessionId,
  commitId: prep.commitId, walletInvocations: 0 };
const first = new Session(createClient(), { sessionId: prep.sessionId, commits: capabilities });
try {
  const before = await first.commits.refresh(prep.commitId);
  assert.equal(before.state, "needs_signature");
  await assert.rejects(first.commits.execute(prep.commitId), /injected_provider_response_loss_after_broadcast/);
  assert.ok(observerHash);
  const record = saved.get(prep.commitId);
  assert.ok(record?.clientRequestId && record.attemptId);
  assert.equal(record.transactionId, undefined, "SDK never received the hash");
  assert.equal(record.rejected, undefined, "unknown broadcast cannot be reported as rejection");
  const receipt = await chain.waitForTransactionReceipt({ hash: observerHash, timeout: 60_000 });
  assert.equal(receipt.status, "success");
  const tx = await chain.getTransaction({ hash: observerHash });
  assert.equal(tx.from.toLowerCase(), account.address.toLowerCase());
  assert.equal(tx.to?.toLowerCase(), account.address.toLowerCase());
  assert.equal(tx.value, 0n);
  assert.equal(tx.nonce, initialNonce);
  first.close();
  const second = new Session(createClient(), { sessionId: prep.sessionId, commits: capabilities });
  try {
    const pending = await second.commits.refresh(prep.commitId);
    assert.equal(pending.wallet_attempt?.attempt_id, record.attemptId);
    const resumed = await second.commits.execute(prep.commitId);
    assert.equal(resumed.wallet_attempt?.attempt_id, record.attemptId);
    assert.notEqual(resumed.state, "confirmed", "unknown outcome must remain unresolved");
    assert.equal(walletInvocations, 1);
    assert.equal(saved.get(prep.commitId)?.transactionId, undefined);
    const cold = await second.commits.refresh(prep.commitId);
    assert.equal(cold.wallet_attempt?.attempt_id, record.attemptId);
    assert.notEqual(cold.state, "confirmed", "Commit Service has no reported hash to follow");
    result.status = "PASS";
    result.observed = "Provider broadcast one exact zero-value transaction but lost its hash response. SDK persisted an unknown durable attempt, fresh Session refused to invoke wallet again, and no hash/rejection was fabricated. Fixture-only observer verified one receipt; Commit Service remains unresolved without a reported hash.";
    result.attemptId = record.attemptId;
    result.observerHash = observerHash;
    result.observerBlock = receipt.blockNumber.toString();
    result.commitState = cold.state;
  } finally { second.close(); }
} catch (error) {
  result.status = "FAIL";
  result.observed = `${(error as Error).name}: ${(error as Error).message}`.slice(0, 260);
  result.observerHash = observerHash;
} finally {
  first.close();
  result.walletInvocations = walletInvocations;
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ runId, status: result.status, evidence: out }));
if (result.status !== "PASS") process.exitCode = 1;
