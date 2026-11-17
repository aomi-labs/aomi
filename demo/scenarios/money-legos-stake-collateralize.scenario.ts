import type { Scenario } from "./types";

/**
 * The showpiece: one sentence, two protocols, a position that didn't exist
 * before.
 *
 * Stake ETH with Lido, then put the staked position to work as collateral on
 * Aave and borrow against it. A human doing this has four browser tabs open and
 * needs to know a piece of trivia: Aave v3 does not accept rebasing stETH, it
 * accepts **wstETH**, so there is a wrap step in the middle that nobody asks
 * for and everybody needs.
 *
 * We deliberately do NOT mention wrapping in the prompt. Asking for the outcome
 * and letting the agent discover the intermediate step is the entire demo — if
 * it names wstETH on its own, that is the moment a DeFi-literate viewer sits
 * up. If it doesn't, we have learned something real about the product and the
 * take fails honestly rather than being scripted around.
 */
export const scenario: Scenario = {
  id: "money-legos-stake-collateralize",
  title: "Stake, wrap, collateralize, borrow — from one sentence",
  chains: [1],
  packages: [],
  // Three turns, not two. A six-transaction plan earns an extra confirmation
  // beat: the agent stages and simulates, reports what it found (including the
  // wstETH wrap nobody asked for), and only then asks to commit. Cutting that
  // beat out would misrepresent how the product actually behaves.
  prompts: [
    "Stake 5 ETH with Lido, then use that staked position as collateral on Aave and borrow 1000 USDC against it",
    "Yes — do the whole sequence.",
    "Commit them.",
  ],
  moneyShot:
    "The trace naming wstETH unprompted, then a multi-protocol position opening in a single run.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
