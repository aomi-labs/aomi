import type { Scenario } from "./types";

/**
 * The scenario that motivated the whole studio.
 *
 * This exact prompt was demoed against an unfunded wallet on real mainnet. The
 * agent did ten steps of correct work and concluded "your ETH balance is 0 ETH"
 * — right answer, useless demo. The reasoning was never the problem; the
 * environment was. Recording it on a funded fork is both a good demo and the
 * proof that the studio fixed the actual failure.
 *
 * Rides on stories DS2 / DS3 / P1 (Lido, Rocket Pool, Ether.fi), which run in
 * product-mono's daily smoke lane, so the underlying path is already exercised.
 */
export const scenario: Scenario = {
  id: "ds2-stake-eth",
  title: "Stake half my ETH in the highest-yield pool",
  story: "DS2",
  chains: [1],
  // Liquid staking runs on built-in protocol skills, so this scenario needs no
  // SDK package. It is the cheapest possible first take: nothing to resolve.
  packages: [],
  // Two beats: the ask, then the go-ahead. Take 7 proved one turn ends with a
  // proposal, not a transaction — the agent researches yields and asks which
  // pool; the approval turn is what makes it execute (and it demos better:
  // an agent that spends without confirmation is the wrong story to tell).
  prompts: [
    "Stake half of my ETH in the highest yield pool",
    "Lido is fine — go ahead and execute it.",
  ],
  moneyShot:
    "The ten-step reasoning trace ending in an executed stake rather than an apology.",
  timeoutMs: 180_000,
  expectsExecution: true,
};

export default scenario;
