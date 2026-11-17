import type { Scenario } from "./types";

/**
 * The lending mirror of stake-shootout: make the agent COMPARE money
 * markets and commit to the winner.
 *
 * "Cheapest" is deliberately underspecified — a real borrower means
 * borrow APY, but a good agent should also weigh collateral LTV and
 * liquidation risk when it presents the choice. Aave v3 and Compound v3
 * both have first-class skills, so the comparison is a fair fight the
 * agent can actually referee: read both markets' live rates off the
 * fork, show its math, then open the position with the winner.
 *
 * Turn 2 approves whatever it proposed; the third turn makes it read the
 * opened position back off the chain — health factor and borrow rate as
 * on-chain facts, not claims.
 */
export const scenario: Scenario = {
  id: "ds13-cheapest-borrow",
  title: "Borrow 2,000 USDC at the cheapest rate — agent referees Aave vs Compound",
  chains: [1],
  packages: [],
  // Turn 2 steers the collateral leg through WETH explicitly: the first
  // takes showed the agent reaching for Aave's native-ETH gateway
  // (WrappedTokenGatewayV3), which the aave skill's guard doesn't cover —
  // approval/simulation reverted every time. Wrap-then-supply is the
  // route the skills provably execute (money-legos supplied via
  // Pool.supply). The gateway gap is logged as a product finding.
  prompts: [
    "I need 2,000 USDC but I don't want to sell my ETH. Find me the cheapest borrow — compare at least Aave and Compound and show me the math.",
    "Convincing — open the position on the winner. Wrap my ETH to WETH for the collateral leg rather than using a native-ETH gateway.",
    "Read my position back from the chain: what's my health factor and what rate am I actually paying?",
  ],
  moneyShot:
    "A live rate table the agent computed from the fork, then the position opening on the market it argued for.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
