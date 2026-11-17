import type { Scenario } from "./types";

/**
 * Lending as a *credit* primitive, not a savings account.
 *
 * Supplying to Aave alone is a one-liner and reads as "deposit money, earn
 * yield" — table stakes. Borrowing against it is three transactions (approve,
 * supply, borrow), requires the agent to reason about collateral factors and
 * health, and produces a leveraged position. That is the version a fintech
 * partner recognises as real balance-sheet mechanics.
 *
 * Phrased as an intent with a constraint ("stay conservative"), not a
 * procedure — the interesting question is whether the agent picks a sane LTV
 * on its own rather than borrowing to the limit.
 */
export const scenario: Scenario = {
  id: "aave-borrow-against-usdc",
  title: "Borrow ETH against USDC on Aave, conservatively",
  story: "P2",
  chains: [1],
  packages: [],
  erc20: [
    {
      symbol: "USDC",
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      // Faucet wallet "Alice" — pre-funded with 10,000 USDC by test-env.
      holder: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      amount: "8000000000", // 8,000 USDC (6 decimals)
    },
  ],
  prompts: [
    "Supply 5000 USDC to Aave and borrow ETH against it — stay conservative on the health factor",
    "Good — execute the approval, the supply and the borrow.",
  ],
  moneyShot:
    "The agent choosing its own LTV and explaining the health factor, then three transactions landing in sequence.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
