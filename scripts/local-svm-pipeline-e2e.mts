import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  mintAccountBearer,
  mintAgentApiBearer,
} from "../packages/account/src/index.ts";
import { AomiClient } from "../packages/client/src/index.ts";

const require = createRequire(
  new URL("../packages/client/package.json", import.meta.url),
);
const {
  Connection,
  Keypair,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const productRoot = process.env.AOMI_PRODUCT_ROOT;
const signerFile = process.env.AOMI_SVM_E2E_SIGNER;
const evidenceFile = process.env.AOMI_SVM_E2E_EVIDENCE;
const userId = process.env.AOMI_PIPELINE_E2E_USER_ID;
assert.ok(
  productRoot && signerFile && evidenceFile && userId,
  "backend root, disposable signer, evidence path, and local account ID are required",
);
// Loopback-only overrides let the harness follow isolated workspace ports while
// keeping this signing test unable to target a remote service.
const backend = loopbackOrigin(
  "AOMI_AGENT_E2E_BACKEND_ORIGIN",
  "http://127.0.0.1:8083",
);
const api = loopbackOrigin("AOMI_AGENT_E2E_ORIGIN", "http://127.0.0.1:8084");
const rpc = loopbackOrigin("AOMI_SVM_E2E_RPC_ORIGIN", "http://127.0.0.1:18899");
const ws = loopbackOrigin("AOMI_SVM_E2E_WS_ORIGIN", "ws://127.0.0.1:18900");
const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(signerFile, "utf8"))),
);
const wallet = signer.publicKey.toBase58();
const connection = new Connection(rpc, {
  commitment: "confirmed",
  wsEndpoint: ws,
});
const recipient = Keypair.generate().publicKey;
const lamports = 1_000_000;
const fixture = readFileSync(
  join(productRoot, "aomi/bin/api-server/src/auth.rs"),
  "utf8",
).match(
  /const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/,
);
assert.ok(fixture, "development issuer fixture is missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = fixture[1];
const { bearer } = await mintAccountBearer(userId);
const client = new AomiClient({
  baseUrl: api,
  guest: false,
  oauth: async ({ resource, scopes }) => {
    const token = await mintAgentApiBearer(userId, {
      resource,
      scope: scopes.join(" "),
      client_id: "svm-pipeline-e2e",
      auth_source: "oauth",
      principal_class: "user",
      grant_id: "svm-pipeline-e2e",
    });
    return {
      accessToken: token.bearer,
      expiresAt: token.expiresAt * 1000,
      resource,
      scopes,
      tokenType: "Bearer",
    };
  },
});

await bindWallet();
const before = await connection.getBalance(signer.publicKey);
assert.ok(before > lamports, "owned offline validator funding is missing");
const context = record(
  record(
    await client.pipeline.invoke(
      "/v1/pipeline/apps/default/operations/svm_get_context",
      { topic: "Verify the owned local Solana test chain" },
    ),
  ).result,
);
assert.equal(
  context.rpc_endpoint,
  rpc,
  "backend must resolve exclusively to the owned local RPC before signing",
);
assert.equal(context.address, wallet);
assert.equal(
  context.lamports,
  before,
  "backend and direct RPC must read the same funded local account",
);
assert.ok(typeof context.current_slot === "number" && context.current_slot > 0);

// Give the backend semantic transfer arguments, not locally assembled bytes.
const staged = await client.pipeline.svm.stage({
  kind: "instructions",
  instructions: [
    {
      description: "Local SVM Pipeline E2E transfer",
      kind: "system_transfer",
      version: "v0",
      instructions: [
        {
          program_id: SystemProgram.programId.toBase58(),
          encode: {
            instruction: "transfer",
            args: JSON.stringify({ lamports }),
            account_pubkeys: JSON.stringify({
              from: wallet,
              to: recipient.toBase58(),
            }),
          },
        },
      ],
    },
  ],
});
assert.equal(staged.status, "staged");
assert.equal(staged.version, 2);
assert.equal(staged.actions.length, 1);
const action = staged.actions[0];
assert.equal(action?.lane, "instruction");
assert.ok(action && action.lane === "instruction");
assert.equal(action.instruction.payer, wallet);
const encoded = Buffer.from(action.instruction.data_base64, "base64");
assert.equal(encoded.length, 12);
assert.equal(encoded.readUInt32LE(0), 2);
assert.equal(encoded.readBigUInt64LE(4), BigInt(lamports));
assert.equal(staged.origin.operations.length, 1);
const simulated = await client.pipeline.svm.simulate(staged);
assert.equal(simulated.status, "simulated");
assert.equal(simulated.simulation.status, "passed");
const committed = await client.pipeline.svm.commit(simulated);
assert.equal(committed.status, "committed");
assert.equal(committed.digest, simulated.digest);
// Stateless requests must include the actual backend-assembled transaction.
// Empty/legacy envelopes fail here; no local assembly fallback is allowed.
const requests = committed.requests.filter(
  (entry) => entry.type === "execute_svm",
);
assert.equal(
  requests.length,
  1,
  "commit must return one executable SVM request",
);
const request = requests[0]!;
assert.ok(Array.isArray(request.transactions));
assert.equal(request.transactions.length, 1);
const prepared = request.transactions[0]!;
assert.equal(prepared.payer, wallet);
assert.equal(prepared.cluster, action.instruction.cluster);
assert.ok(typeof prepared.unsigned_transaction_base64 === "string");
const transaction = VersionedTransaction.deserialize(
  Buffer.from(prepared.unsigned_transaction_base64, "base64"),
);
assert.equal(transaction.message.header.numRequiredSignatures, 1);
assert.equal(transaction.message.staticAccountKeys[0].toBase58(), wallet);
const decoded = TransactionMessage.decompile(transaction.message);
const transfers = decoded.instructions.filter(
  (instruction: { programId: { equals: (value: unknown) => boolean } }) =>
    instruction.programId.equals(SystemProgram.programId),
);
assert.equal(transfers.length, 1);
assert.ok(
  decoded.instructions.every(
    (instruction: { programId: { equals: (value: unknown) => boolean } }) =>
      instruction.programId.equals(SystemProgram.programId) ||
      instruction.programId.equals(ComputeBudgetProgram.programId),
  ),
  "unexpected program in assembled request",
);
const transfer = SystemInstruction.decodeTransfer(transfers[0]);
assert.equal(transfer.fromPubkey.toBase58(), wallet);
assert.equal(transfer.toPubkey.toBase58(), recipient.toBase58());
assert.equal(transfer.lamports, BigInt(lamports));
transaction.sign([signer]);
const signature = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: false,
});
assert.ok(typeof prepared.last_valid_block_height === "number");
const confirmation = await connection.confirmTransaction(
  {
    signature,
    blockhash: transaction.message.recentBlockhash,
    lastValidBlockHeight: prepared.last_valid_block_height,
  },
  "confirmed",
);
assert.equal(confirmation.value.err, null);
const receipt = await connection.getTransaction(signature, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});
assert.ok(receipt?.meta);
assert.equal(receipt.meta.err, null);
assert.equal(await connection.getBalance(recipient), lamports);
assert.equal(
  await connection.getBalance(signer.publicKey),
  before - lamports - receipt.meta.fee,
);
const replay = await client.pipeline.svm.commit(simulated);
assert.deepEqual(
  replay,
  committed,
  "same Build digest must replay the same commit result",
);
const evidence = {
  result: "pass",
  scope:
    "SDK SVM stage -> backend semantic encoding -> simulate -> commit -> local sign -> real RPC confirmation",
  backend,
  api,
  rpc,
  wallet,
  recipient: recipient.toBase58(),
  cluster: prepared.cluster,
  stageDigest: staged.digest,
  simulationDigest: simulated.digest,
  commitReplayIdentical: true,
  signature,
  slot: receipt.slot,
  lamports,
  fee: receipt.meta.fee,
};
writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "expected JSON object",
  );
  return Object.fromEntries(Object.entries(value));
}

function loopbackOrigin(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  const parsed = new URL(value);
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    `${name} must remain loopback-only`,
  );
  return parsed.toString().replace(/\/$/, "");
}

async function bindWallet() {
  const challenge = await fetch(
    `${backend}/api/account/authorization/challenge`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ chain_type: "svm", wallet, mode: "bind" }),
    },
  );
  if (challenge.status === 409) return;
  assert.equal(challenge.status, 200, "local wallet bind challenge failed");
  const body = record(await challenge.json());
  assert.ok(typeof body.message_base64 === "string");
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(signer.secretKey).subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(
    null,
    Buffer.from(body.message_base64, "base64"),
    privateKey,
  ).toString("base64");
  const committed = await fetch(`${backend}/api/account/authorization/commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ permit: body.permit, signature }),
  });
  assert.equal(committed.status, 200, "local wallet bind commit failed");
}
