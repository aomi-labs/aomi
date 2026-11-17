import type { Scenario } from "./types";

/**
 * Scenario 7: the research turn, on Solana — read-only on purpose.
 *
 * This is the answer to the demo that started this whole effort: "stake half
 * my ETH in the highest yield pool" produced ten steps of correct reasoning
 * and then died on execution. The reasoning was never the weak part. So this
 * scenario ships the reasoning ALONE, where nothing can fail: no staging, no
 * approval, no broadcast, no wallet.
 *
 * Why it earns its place next to DS6 rather than being a lesser version of it:
 *
 * - It is the most reliable asset in the catalog. Execution takes are subject
 *   to LLM variance in bundle construction (DS6 lost three takes in a row to
 *   a repair loop); a read turn has no bundle to get wrong.
 * - Comparing venues is the thing a human cannot do quickly and an agent can.
 *   For a partner evaluating "what does this actually add", the scan IS the
 *   pitch — execution is table stakes once the answer is known.
 * - It cuts short. 20 seconds of an agent naming real venues with real rates
 *   is a social clip; a full execution take is not.
 *
 * `expectsExecution: false` is load-bearing: the recorder skips its
 * chain-movement proof, and no balance may move. If a take here ever spends
 * anything, that is a bug in the agent, not a better video.
 */
export const scenario: Scenario = {
  id: "ds7-sol-yield-scan",
  title: "Compare Solana liquid-staking yields",
  chains: [],
  packages: [],
  svm: {
    cluster: "mainnet-beta",
    // Funded like a real holder even though nothing is spent: the agent
    // reasons about what THIS wallet should do, and a scan against an empty
    // wallet reads as a toy.
    fund: { sol: "10000000000" },
    tokenAccounts: [
      {
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "25000000",
      },
    ],
    // Nothing should move. These are upper bounds on a wallet that must end
    // the take exactly as it started — the inverse of DS6's assertions, and
    // the only honest way to prove a "read-only" take was read-only.
    verify: [{ kind: "sol", atLeast: "9990000000" }],
  },
  // One turn, no approval beat — there is nothing to approve. The prompt names
  // the venues so the comparison is checkable by a viewer who knows Solana,
  // and asks for a recommendation so the turn ends on a conclusion rather
  // than a table.
  prompts: [
    "Compare the current liquid staking yields on Solana — Marinade, Jito, " +
      "and Sanctum. Which would you put 5 SOL into, and why? Don't execute " +
      "anything yet.",
  ],
  moneyShot:
    "Real venues, real rates, and a recommendation with a reason — the " +
    "research turn that the original failed demo never got credit for.",
  timeoutMs: 150_000,
  expectsExecution: false,
};

export default scenario;
