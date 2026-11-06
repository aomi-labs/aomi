/**
 * Solana from sign-in to a signed Commit, with one local key: SIWS sign-in,
 * one chat turn, a Pipeline Build, and its Commit signed by `solanaSigner`.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { Aomi, normalizeSolanaCluster, wallet } from "@aomi-labs/client";
import { solanaSigner } from "@aomi-labs/client/solana";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const secret = process.env.AOMI_SOLANA_PRIVATE_KEY?.trim();
if (!secret)
  throw new Error(
    "Set AOMI_SOLANA_PRIVATE_KEY (base58 or a solana-keygen JSON byte array)",
  );
const cluster = normalizeSolanaCluster(
  process.env.AOMI_SOLANA_CLUSTER || "solana:devnet",
);
if (!cluster)
  throw new Error("AOMI_SOLANA_CLUSTER must be mainnet, devnet or testnet");
const [app, operation, args] = [
  process.env.AOMI_PIPELINE_APP?.trim(),
  process.env.AOMI_PIPELINE_OPERATION?.trim(),
  process.env.AOMI_PIPELINE_ARGS?.trim(),
];
if (!app || !operation || !args)
  throw new Error(
    "Set AOMI_PIPELINE_APP, AOMI_PIPELINE_OPERATION and AOMI_PIPELINE_ARGS (JSON) for the Build",
  );

// The same key signs in (SIWS) and signs the Commit. `cluster` tells the
// agent which cluster the wallet is on; a custom RPC serves that cluster.
const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
const svm = solanaSigner(secret, {
  cluster,
  rpcUrls: rpcUrl ? { [cluster]: rpcUrl } : undefined,
});
const aomi = new Aomi({
  baseUrl,
  auth: wallet(svm),
  signer: { svm },
});

// 1. Sign in: the first account call runs the SIWS challenge.
const me = await aomi.account.me();
console.log(`1. Signed in as ${me.user?.id} with ${svm.address} (${cluster})`);

// 2. One chat turn. The agent sees the wallet and its cluster.
const turn = await aomi.agent.thread().send("What is my SOL balance?");
console.log(`2. aomi> ${turn.reply}`);

// 3. Build: stage and simulate one operation. Nothing is signed yet.
const build = await aomi.pipeline.build(
  operation,
  JSON.parse(args) as Record<string, unknown>,
  { app },
);
console.log(`3. Built ${build.chainFamily} ${operation}`);
console.log(`   simulation: ${build.simulation.status}`);
for (const change of build.balanceChanges)
  console.log(`   ${change.asset} ${change.amount}`);

// 4. Commit, review, sign. Commit Service renews the blockhash right before
// the key signs, then sends and confirms it.
const commit = await build.commit();
try {
  console.log(`4. Commit ${commit.view.commit_id} · ${commit.kind}`);
  const terminal = createInterface({ input: stdin, output: stdout });
  const answer = await terminal.question("   Sign and send it? [y/N] ");
  terminal.close();
  if (answer.trim().toLowerCase() !== "y") {
    await commit.reject();
    console.log("   Rejected; nothing was signed.");
  } else {
    await commit.sign();
    const settled = await commit.settled();
    console.log(`   ${settled.state} ${settled.transaction_id ?? ""}`);
  }
} finally {
  commit.close();
}
