import type { Scenario } from "./types";

/**
 * Staking, but make it an argument.
 *
 * DS2 asks for "the highest yield pool" and the agent picks Lido. This one
 * forces a defended comparison across liquid staking *and* restaking — where
 * the honest answer involves risk that a naive yield ranking hides (restaking
 * pays more because it carries slashing exposure the vanilla product doesn't).
 *
 * The demo value is not the transaction. It is watching the agent decline to
 * just chase the biggest APR number, then act on its own reasoning. An agent
 * that says "the highest yield here is not the one I'd pick, and here's why"
 * is a fundamentally different product from a yield sorter.
 */
export const scenario: Scenario = {
  id: "stake-shootout",
  title: "Lido vs Rocket Pool vs Ether.fi — argue, then act",
  story: "DS2/DS3/P1",
  chains: [1],
  packages: [],
  prompts: [
    "Compare Lido, Rocket Pool and Ether.fi for staking 4 ETH — I care about risk, not just headline APR. Tell me which you'd actually pick and why.",
    "Agreed with your reasoning — go ahead and stake it there.",
  ],
  moneyShot:
    "The side-by-side with a stated risk judgement, then the agent executing on the venue it argued for — not the top APR.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
