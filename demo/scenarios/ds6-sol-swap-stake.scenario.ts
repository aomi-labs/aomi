import type { Scenario } from "./types";

/**
 * Scenario 6: one agent, two virtual machines — the Solana leg.
 *
 * Runs entirely on the Surfpool mainnet-fork mirror; phase 0 proved both legs
 * execute there (Jupiter swap finalized, Marinade stake confirmed — see
 * docs/specs/SOLANA-DEMO-PLAN.md "Phase 0 VERDICT"). Not a one-take real-money
 * proof video after all: as re-recordable as DS2.
 *
 * Environment contract:
 * - mirror up: `test-env svm up --cluster mainnet-beta`, with the operator
 *   providers.toml `[surfpool.mainnet-beta]` airdropping the demo wallet
 *   10 SOL and fabricating 25 USDC (fixtures re-apply on reset)
 * - the wallet's Marinade authorization done once via the bind/client_auto
 *   ceremonies (demo/capture/authorize-svm.mts)
 */
export const scenario: Scenario = {
  id: "ds6-sol-swap-stake",
  title: "Swap 5 SOL for USDC, then stake the rest",
  chains: [],
  apps: [],
  svm: {
    cluster: "mainnet-beta",
    // 10 SOL, written after reset. Reset does NOT re-airdrop: the first take
    // of this scenario started from the phase-0 spike's leftover 7.5 SOL and
    // still passed, because the assertions below used to be loose enough to
    // straddle both starting states. Both halves of that are now fixed.
    fund: { sol: "10000000000" },
    tokenAccounts: [
      {
        // 25 USDC of "existing" balance, so the post-swap number is visibly
        // a sum rather than the whole story. Declared here rather than left
        // to the providers.toml fixture for the same reason as `fund`.
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "25000000",
      },
      // NO mSOL fixture — deliberately.
      //
      // Earlier takes seeded one, first empty (`"0"`) and then as dust, to work
      // around a backend built before #912: the agent could not create the
      // mSOL ATA itself, so it looped on "Correcting Marinade stake account"
      // until the take timed out. The demo backend is now rebuilt past #912,
      // and the Marinade manifest tells the agent to stage
      // `create_idempotent` when the account is absent.
      //
      // Leaving the fixture out is the honest version of this demo: a
      // first-time staker genuinely has no mSOL account, and the agent
      // creating one is part of what we are claiming it can do. It also means
      // this scenario FAILS if that regresses, instead of hiding it.
    ],
    // Each bound is chosen to FAIL if its leg silently didn't execute — a
    // 10 SOL start makes that possible to state precisely. Swap-only leaves
    // ~5 SOL (caught by the SOL bound); stake-only leaves USDC at 25 (caught
    // by the USDC bound); neither leaves mSOL at 0.
    verify: [
      // Both legs consume the balance: ~5 swapped, the rest staked. A sane
      // gas buffer is fine; 1.5 SOL left means the stake never happened.
      { kind: "sol", atMost: "1500000000" },
      // 25 USDC fixture + ≥250 from the swap (wide tolerance for price).
      {
        kind: "spl",
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        atLeast: "275000000",
      },
      // ~5 SOL staked at ~1.41 SOL/mSOL mints ~3.5 mSOL; 2.0 leaves room for
      // the exchange rate and a partial-stake decision by the agent.
      {
        kind: "spl",
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        atLeast: "2000000000",
      },
    ],
  },
  // One leg per turn, each approved before the next is asked for.
  //
  // This shape is the difference between a take that works and one that hangs,
  // and the signal was clean: every passing take simulated 8 transactions,
  // every hung take simulated 9 and then retried forever. Asking for both legs
  // in one sentence ("Swap 5 SOL for USDC, then stake the rest") invites the
  // agent to stage them as a single batch — and the stake cannot simulate
  // against a SOL balance the swap has not freed yet, so the batch fails and
  // the agent loops trying to repair it.
  //
  // Splitting the legs removes the joint simulation entirely. It also reads
  // better on camera: a conversation rather than a command.
  //
  // Two smaller lessons baked into the wording:
  // - A single-prompt version (no approval turns) hangs differently — the
  //   agent parks on "⏳ waiting for wallet approval" until the timeout.
  // - Approvals must be worded AS approvals. "Go ahead and execute both"
  //   reads as an instruction to redo the swap, and the agent re-stages a leg
  //   that has already spent the balance.
  prompts: [
    "Swap 5 SOL for USDC.",
    "Yes, approve it.",
    "Now stake the rest with Marinade.",
    "Yes, approve it.",
  ],
  moneyShot:
    "The chain switcher reading SVM while the same agent that staked ETH " +
    "yesterday swaps and stakes on Solana — two VMs, one conversation.",
  timeoutMs: 150_000,  // a passing take streams ~25s/turn; failures cost less
  expectsExecution: true,
};

export default scenario;
