/** Drop one real Commit Service attempt-create response, then retry the same SDK request. */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mintAccountBearer } from "../packages/account/src/index.ts";
import { AomiClient, Session } from "../packages/client/src/index.ts";

const required = (name: string) => { const value = process.env[name]; assert.ok(value, `${name} is required`); return value; };
const backendRoot = resolve(required("AOMI_PRODUCT_ROOT"));
const origin = new URL(required("AOMI_STABILITY_COMMIT_ORIGIN"));
assert.ok(["127.0.0.1", "localhost", "::1"].includes(origin.hostname));
const prepPath = resolve(required("AOMI_STABILITY_PREP_RESULT"));
const prep = JSON.parse(await readFile(prepPath, "utf8")) as { status: string; sessionId: string; commitId: string; account: string };
assert.equal(prep.status, "PASS");
assert.ok(prep.sessionId && prep.commitId && prep.account);
const runId = randomUUID();
const out = join(resolve(required("AOMI_STABILITY_EVIDENCE")), runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const rev = (root: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const manifest = { schemaVersion: 1, runId, at: new Date().toISOString(), scenario: "W05 lost attempt creation response",
  backendRuntimeRevision: required("AOMI_STABILITY_BACKEND_RUNTIME_REVISION"),
  frontendRuntimeRevision: required("AOMI_STABILITY_FRONTEND_RUNTIME_REVISION"),
  backendSourceRevision: rev(backendRoot), frontendRunnerRevision: rev(resolve(import.meta.dirname, "..")),
  databaseMigrationDigest: required("AOMI_STABILITY_DATABASE_MIGRATION_DIGEST"),
  prepPath, sessionId: prep.sessionId, commitId: prep.commitId, wallet: prep.account, origin: origin.origin,
  realBaseSends: 0, disposableForkSends: 0 };
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
const issuer = (await readFile(join(backendRoot, "aomi/bin/api-server/src/auth.rs"), "utf8"))
  .match(/const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/);
assert.ok(issuer);
process.env.PORTAL_SERVICE_PRIVATE_KEY = issuer[1];
const userId = required("AOMI_STABILITY_USER_ID");
const client = new AomiClient({ baseUrl: origin.origin, guest: false,
  getAccountBearer: async () => (await mintAccountBearer(userId)).bearer });
const originalRequest = client.request.bind(client);
let injected = false;
let walletInvocations = 0;
let firstAttempt: { attempt_id: string; may_invoke_wallet: boolean } | undefined;
let retryAttempt: { attempt_id: string; may_invoke_wallet: boolean } | undefined;
client.request = (async (method, path, options) => {
  const response = await originalRequest(method, path, options);
  if (method === "POST" && path.endsWith("/wallet-attempts")) {
    const attempt = response as { attempt_id: string; may_invoke_wallet: boolean };
    if (!injected) { firstAttempt = attempt; injected = true; throw new Error("injected_response_loss_after_server_write"); }
    retryAttempt = attempt;
  }
  return response;
}) as typeof client.request;
const recovery = new Map<string, { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true }>();
const capabilities = { recovery: {
  load: (_thread: string, id: string) => recovery.get(id),
  save: (_thread: string, id: string, value: { clientRequestId: string; attemptId?: string; transactionId?: string; rejected?: true }) => { recovery.set(id, value); },
  remove: (_thread: string, id: string) => { recovery.delete(id); },
},
  walletSendPreflight: async (view: { signer: string }, payload: { chain_id: number; transaction: { to: string; value: string; data: string } }) => {
    assert.equal(view.signer.toLowerCase(), prep.account.toLowerCase());
    assert.equal(payload.chain_id, 8453);
    assert.equal(payload.transaction.to.toLowerCase(), prep.account.toLowerCase());
    assert.equal(BigInt(payload.transaction.value), 0n);
    assert.equal(payload.transaction.data, "0x");
  },
  walletSend: async () => { walletInvocations++; throw new Error("wallet_invocation_forbidden_in_w05"); },
};
const result: Record<string, unknown> = { runId, status: "BLOCKED", caseId: "W05", sessionId: prep.sessionId,
  commitId: prep.commitId, walletInvocations: 0 };
let first = new Session(client, { sessionId: prep.sessionId, commits: capabilities });
try {
  const before = await first.commits.refresh(prep.commitId);
  assert.equal(before.state, "needs_signature");
  await assert.rejects(first.commits.execute(prep.commitId), /injected_response_loss_after_server_write/);
  assert.ok(firstAttempt?.attempt_id && firstAttempt.may_invoke_wallet);
  const saved = recovery.get(prep.commitId);
  assert.ok(saved?.clientRequestId && !saved.attemptId, "SDK saved request ID before response loss");
  first.close();
  const second = new Session(client, { sessionId: prep.sessionId, commits: capabilities });
  try {
    const persisted = await second.commits.refresh(prep.commitId);
    assert.equal(persisted.wallet_attempt?.attempt_id, firstAttempt.attempt_id);
    const resumed = await second.commits.execute(prep.commitId);
    assert.equal(resumed.wallet_attempt?.attempt_id, firstAttempt.attempt_id);
    assert.equal(walletInvocations, 0, "fresh SDK must not invoke an uncertain wallet attempt");
    const retry = await client.request<{ attempt_id: string; may_invoke_wallet: boolean }>(
      "POST", `/api/commits/${prep.commitId}/wallet-attempts`, { sessionId: prep.sessionId,
        body: { version: before.version, review_digest: before.review?.digest,
          client_request_id: saved.clientRequestId, transport: "browser_send" } });
    assert.equal(retry.attempt_id, firstAttempt.attempt_id);
    assert.equal(retryAttempt?.attempt_id, firstAttempt.attempt_id);
    assert.equal(retryAttempt?.may_invoke_wallet, false);
    assert.equal(walletInvocations, 0);
    result.status = "PASS";
    result.observed = "Real server wrote one durable wallet attempt; first HTTP response was dropped. Fresh SDK read back the same attempt without invoking the wallet; explicit public API retry with the saved client request ID returned the same attempt and disallowed a second invocation.";
    result.attemptId = firstAttempt.attempt_id;
    result.firstMayInvokeWallet = firstAttempt.may_invoke_wallet;
    result.retryMayInvokeWallet = retryAttempt.may_invoke_wallet;
    result.clientRequestId = saved.clientRequestId;
  } finally { second.close(); }
} catch (error) {
  result.status = "FAIL";
  result.observed = `${(error as Error).name}: ${(error as Error).message}`.slice(0, 260);
  result.injected = injected;
  result.firstAttemptId = firstAttempt?.attempt_id;
  result.retryAttemptId = retryAttempt?.attempt_id;
} finally {
  first.close();
  result.walletInvocations = walletInvocations;
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ runId, status: result.status, evidence: out }));
if (result.status !== "PASS") process.exitCode = 1;
