/**
 * Aomi as an execution layer for your own contract.
 *
 * The agent builds and simulates a `registerRoot(bytes32)` call on an anchor
 * registry you deployed. Before anything is signed, the script checks that
 * the request targets that contract, calls that function with that root,
 * sends no value, and passed simulation. Only then does a local Viem key sign.
 *
 * Prerequisites (nothing here deploys a contract or funds a key):
 * - A contract exposing `function registerRoot(bytes32 root)` on EVM_CHAIN_ID.
 * - A funded throwaway key for that chain, never a production key.
 * - An Aomi deployment that can simulate on that chain.
 */

import {
  Aomi,
  ExpectedCalls,
  isTerminalCommit,
  type Wallets,
} from "@aomi-labs/client";
import { isAddress, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { createViemWalletFromEnvironment } from "../shared/viem-wallet";
import { sortedCommits } from "../shared/sorted-commits";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const registry = process.env.ANCHOR_REGISTRY_ADDRESS?.trim() ?? "";
if (!isAddress(registry)) {
  throw new Error("ANCHOR_REGISTRY_ADDRESS must be a 0x-prefixed address");
}
// Use your real Merkle root here. The fallback is a fresh demo value so a
// rerun never collides with an earlier registration.
const root = (process.env.ANCHOR_ROOT?.trim() ||
  keccak256(stringToHex(`aomi-anchor-demo:${Date.now()}`))) as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
  throw new Error("ANCHOR_ROOT must be a 32-byte 0x-prefixed hex value");
}

// 1. A local Viem key from AOMI_PRIVATE_KEY, EVM_CHAIN_ID, and EVM_RPC_URL.
const localWallet = createViemWalletFromEnvironment();
const signTransaction = localWallet?.evm?.signTransaction;
if (!localWallet?.evm || !signTransaction) {
  throw new Error(
    "Set AOMI_PRIVATE_KEY, EVM_CHAIN_ID, and EVM_RPC_URL for a funded test key",
  );
}
const chainId = Number(process.env.EVM_CHAIN_ID);

// 2. Write down what you approve before asking the agent for anything.
const expected = new ExpectedCalls({
  chainId,
  to: registry,
  abi: parseAbi(["function registerRoot(bytes32 root)"]),
  functionName: "registerRoot",
  args: [root],
});

// 3. Re-check the exact transaction inside the signer as a last line of
// defense: Commit Service hands the wallet its own prepared payload.
const wallet: Wallets = {
  evm: {
    ...localWallet.evm,
    signTransaction: async (payload) => {
      expected.assert(payload);
      return signTransaction(payload);
    },
  },
};
const aomi = new Aomi({ baseUrl, wallet });

console.log(`API: ${baseUrl}`);
console.log(`Signer: ${wallet.evm!.address} on chain ${chainId}`);
console.log(`Registry: ${registry}`);
console.log(`Root: ${root}\n`);

// 4. Ask for the call. Name the contract, function, and arguments exactly.
const run = aomi.agent.run(
  [
    `On chain ${chainId}, call registerRoot(bytes32 root) on contract ${registry}`,
    `with root ${root} and no ETH value, from my wallet ${wallet.evm!.address}.`,
    "The ABI is: function registerRoot(bytes32 root).",
    "Simulate it and prepare it for my wallet to sign. Do not substitute",
    "another contract, function, or argument.",
  ].join(" "),
);
run.on("action", (action) => {
  // Historical Actions hold the turn until answered, so resolve them here.
  if (action.state !== "pending") return;
  const verification = expected.verify(action);
  console.log(`[action ${action.id}] ${action.request.type}`);
  for (const mismatch of verification.mismatches)
    console.log(`  mismatch: ${mismatch.message}`);
  void (
    verification.ok
      ? run.session.actions.execute(action.id)
      : run.reject(action.id, "Request does not match the approved call")
  ).catch((error: unknown) => console.error(`[action] ${String(error)}`));
});

const result = await run.result();
const reply = [...result.messages]
  .reverse()
  .find((message) => message.sender === "agent")?.content;
console.log(`aomi> ${reply ?? "(no text)"}\n`);

// 5. Reopen the durable session; prepared work is a Commit.
const session = await aomi.agent.openSession(result.sessionId);
let failed = false;
try {
  const commits = sortedCommits(session.commits.all());
  if (commits.length === 0) {
    console.log("The agent prepared no transaction. Read its reply above.");
    failed = true;
  }
  for (const listed of commits) {
    let view = await session.commits.refresh(listed.commit_id);
    // A Commit can advance sign -> broadcast; review every step.
    while (view.action && !isTerminalCommit(view)) {
      const verification = expected.verify(
        session.commits.review(view.commit_id),
      );
      console.log(
        `[commit ${view.commit_id}] ${view.action.kind}, simulation ${verification.simulation ?? "n/a"}`,
      );
      for (const call of verification.calls) {
        console.log(
          `  ${call.to} ${call.functionName ?? call.data.slice(0, 10)}(${(call.args ?? []).join(", ")}) value ${call.value}`,
        );
      }
      if (!verification.ok) {
        for (const mismatch of verification.mismatches)
          console.log(`  mismatch: ${mismatch.message}`);
        await session.commits.reject(view.commit_id);
        console.log("  rejected: request does not match the approved call");
        failed = true;
        break;
      }
      if (!session.commits.canExecute(view)) {
        console.log("  the local wallet cannot execute this step");
        failed = true;
        break;
      }
      const next = await session.commits.execute(view.commit_id, {
        expectedVersion: view.version,
        expectedReviewDigest: view.review?.digest,
      });
      if (next.version <= view.version) break;
      view = next;
    }
    console.log(
      `  state: ${view.state}${view.transaction_id ? ` · tx ${view.transaction_url ?? view.transaction_id}` : ""}`,
    );
  }
} finally {
  session.close();
}
process.exitCode = failed ? 1 : 0;
