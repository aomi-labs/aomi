import type { Scenario } from "./types";

/**
 * The bridge demo's encore: go to Base AND come back, in one conversation.
 *
 * ds4 proved a one-way bridge completes on forks. This take proves the
 * machinery is symmetric: the actors watch every configured SpokePool, so
 * a Base→mainnet deposit gets filled exactly like mainnet→Base. On camera
 * that reads as "the agent moves my money wherever, whenever" — which is
 * the actual product claim — and mechanically it exercises the E2E
 * executor on a second chain (Base-side deposit) for the first time.
 *
 * The return leg is phrased as a decision ("half of what landed") so the
 * agent has to read the REAL arrived amount off Base first — it can't
 * pattern-match the number from turn 1.
 *
 * Both actors armed: the agent may pick Across or canonical for either
 * leg. Note a canonical Base→mainnet withdrawal has a 7-day challenge
 * window in reality — a correct agent should choose Across for the
 * return leg and ideally SAY why; if it proposes the canonical
 * withdrawal, the take still executes (OpDepositFinalizer only covers
 * L1→L2, so the return would stall) and the block gate fails it — an
 * honest outcome worth keeping.
 */
export const scenario: Scenario = {
  id: "ds14-bridge-round-trip",
  title: "Bridge to Base and back — round trip in one conversation",
  chains: [1, 8453],
  packages: [],
  actors: ["across", "base-native"],
  prompts: [
    "Move 4 ETH over to Base for me.",
    "Do it.",
    "Nice. Now bring half of what landed back to mainnet — pick the fastest route and tell me why.",
    "Go ahead.",
  ],
  moneyShot:
    "The agent reading the true arrived amount off Base before computing the return leg — then balances moving on BOTH chains in one take.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
