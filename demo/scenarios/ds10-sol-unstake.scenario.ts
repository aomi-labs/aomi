import type { Scenario } from "./types";

/**
 * Scenario 10: instant unstake — DS6 played backwards, and the trust take.
 *
 * Every staking demo on the internet shows money going IN. Nobody shows the
 * exit, because for most products the exit is where the story gets awkward
 * (cooldowns, tickets, "come back in 3 days"). Marinade's liquid_unstake is
 * instant at the cost of a pool fee — which hands the agent a genuinely
 * agent-shaped decision to narrate on camera: pay the fee for liquidity now,
 * or order a delayed unstake for free. The prompt forces the "now" branch;
 * the agent explaining WHY (fee vs. wait, with the simulated fee as a real
 * number) is the money shot.
 *
 * Fixture note: this wallet is seeded WITH mSOL, unlike DS6 which must start
 * without it. That is not the DS6 workaround sneaking back — it is the
 * premise. A returning staker holds mSOL by definition, and 3.5 mSOL matches
 * what DS6's stake actually minted, so the two takes cut together as one
 * story ("staked last week, needed cash this week").
 *
 * Skill surface: `liquid_unstake` is allowlisted in the marinade manifest
 * (deposit / liquid_unstake / order_unstake / claim), wallet-side accounts
 * are get_msol_from / authority / transfer_sol_to — all the E2E wallet. The
 * mSOL ATA exists (we seed it), so unlike DS6 there is no account-creation
 * side quest: this should be the cleanest execution take on the SVM roster.
 */
export const scenario: Scenario = {
  id: "ds10-sol-unstake",
  title: "Instantly unstake 2 mSOL back to SOL",
  chains: [],
  packages: [],
  svm: {
    cluster: "mainnet-beta",
    // 1 SOL of gas money. Deliberately thin: the take's point is that the
    // UNSTAKE is what produces spendable SOL, and a fat starting balance
    // would bury the delta the verify bounds prove.
    fund: { sol: "1000000000" },
    tokenAccounts: [
      {
        // 3.5 mSOL — DS6's real output, continuity on purpose.
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        amount: "3500000000",
      },
    ],
    verify: [
      // 2 mSOL burned from 3.5 leaves 1.5; atLeast catches over-unstaking
      // (the "helpful" agent draining the position), atMost catches a
      // no-op take that never burned anything.
      {
        kind: "spl",
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        atLeast: "1450000000",
        atMost: "1550000000",
      },
      // 2 mSOL at ~1.41 SOL/mSOL is ~2.82 SOL before the liq-pool fee
      // (0.1–9% depending on pool depth). 1 + 2.5 = 3.5 SOL floor tolerates
      // a fat fee day; below that the unstake didn't actually land.
      { kind: "sol", atLeast: "3500000000" },
    ],
  },
  // Two beats. The first prompt states the constraint (now, not in 3 days)
  // so the agent must choose liquid_unstake over order_unstake and defend
  // the fee — that reasoning is the differentiator, not the transaction.
  prompts: [
    "I need cash today — unstake 2 mSOL back to SOL right now. Instant is worth a fee.",
    "Yes, pay the fee and do it.",
  ],
  moneyShot:
    "The agent quoting the actual pool fee from simulation and framing the " +
    "trade — instant-with-fee versus free-in-3-days — before executing the " +
    "exit. Staking demos show the entrance; this one proves the door out.",
  timeoutMs: 240_000,
  expectsExecution: true,
};

export default scenario;
