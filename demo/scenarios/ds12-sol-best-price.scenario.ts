import type { Scenario } from "./types";

/**
 * Scenario 12: comparison-shop the swap — two venues quoted on camera,
 * best one executed.
 *
 * DS6 already proves "agent swaps on Solana". What it does NOT show is why
 * routing through an agent beats opening Jupiter yourself: the agent can
 * quote MULTIPLE venues, show its work, and route to the winner. The skill
 * roster has both halves — `jupiter_prepare_swap` (quote+build in one call)
 * and `raydium_get_quote` / `raydium_build_swap` (quote and build split) —
 * so a head-to-head is native, no new capability required.
 *
 * The prompt explicitly names both venues. Left to itself the agent would
 * reasonably just use Jupiter (it IS an aggregator — meta-routing is its
 * job); naming Raydium forces the on-camera comparison, and honestly, an
 * aggregator's route vs. a single AMM's pool is a fair fight Jupiter usually
 * wins — the agent SAYING so, with both numbers visible, is the shot.
 *
 * Trace-driven take: the working trace will show two quote steps with two
 * USDC amounts side by side before anything stages. Whoever cuts the video
 * should freeze there — that frame is the thesis.
 *
 * CONFIDENCE: medium-high. Jupiter execution is take-proven; Raydium is
 * quote-only here in the happy path (the losing quote never executes), so
 * the unproven surface only matters if Raydium wins the quote — and both
 * venues share DS6's fresh-fork requirement. RE-FORK BEFORE SHOOTING.
 */
export const scenario: Scenario = {
  id: "ds12-sol-best-price",
  title: "Best execution: quote Jupiter vs Raydium, take the winner",
  chains: [],
  packages: [],
  svm: {
    cluster: "mainnet-beta",
    fund: { sol: "10000000000" },
    tokenAccounts: [
      {
        // Existing balance so the post-swap USDC reads as a sum, not the
        // whole story — same reasoning as DS6.
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "25000000",
      },
    ],
    verify: [
      // 3 SOL out + fees: >7.2 SOL left means no swap happened.
      { kind: "sol", atMost: "7200000000" },
      // 3 SOL at spot (~73 USDC/SOL as of authoring) is ~220 USDC on top of
      // the 25 fixture; 180 floor absorbs price drift between authoring and
      // shooting. If SOL moves far enough to break this bound, re-derive it
      // from the DS6 rate math rather than loosening it blindly.
      {
        kind: "spl",
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        atLeast: "180000000",
      },
    ],
  },
  // Every parameter the agent could reasonably ask about is answered IN the
  // ask. The first shoot's turn 1 ended with "what slippage should I use?"
  // — a good question that the scripted approval didn't answer, and a
  // scripted conversation cannot improvise. Rule for authoring multi-turn
  // scenarios: canned turn N+1 only works if turn N's ask leaves the agent
  // nothing legitimate to ask back.
  prompts: [
    "Swap 3 SOL for USDC. Quote both Jupiter and Raydium first, tell me which gives the better price, and use up to 100 bps slippage on either.",
    "Go with the better one — execute.",
  ],
  moneyShot:
    "Two live quotes side by side in the working trace — Jupiter vs Raydium, " +
    "real numbers — then the agent routing to the winner. The frame that " +
    "answers 'why not just open the DEX myself?'",
  // 7 min, not the house 4: this take's arc is quote → simulate → (often) a
  // route failure on the fork snapshot → diagnose → re-quote → execute. The
  // first shoot showed the agent doing exactly that, correctly, and getting
  // cut at 240s mid-repair. Comparison-shopping earns a longer reel.
  timeoutMs: 420_000,
  expectsExecution: true,
};

export default scenario;
