import type { Scenario } from "./types";

/**
 * Cross-chain intent, end to end — the scenario the mock relayer was built
 * for (docs/specs/MOCK-RELAYER.md).
 *
 * Both legs are forked (mainnet + Base) and the `across` chain actor plays
 * the relayer nobody else is running: it watches the mainnet fork's
 * SpokePool for the deposit and lands the REAL `fillRelay` on the Base
 * fork's REAL SpokePool, ~4s later. So the take shows a bridge that
 * actually completes — deposit on one chain, arrival on the other — with
 * zero real capital. An earlier version of this scenario pinned the
 * canonical bridge and could only ever show the deposit leg ("half true");
 * that constraint is gone, and the agent is free to pick Across, which is
 * what it prefers on real mainnet anyway.
 *
 * Made harder than "bridge some ETH": the agent has to decide how much to
 * keep back for gas rather than being handed an amount. And the third turn
 * makes the agent CHECK the destination — on camera, against the Base fork
 * — so the arrival is the agent's own report, not a caption.
 *
 * The recorder funds ONLY mainnet (source leg) and wipes the wallet's
 * EIP-7702 sweeper code on both forks first — without that wipe the fill's
 * ETH is stolen in-transaction by the delegate the fork inherits from the
 * real chain (see wipeAccountCode in capture/test-env.ts).
 */
export const scenario: Scenario = {
  id: "ds4-bridge-to-base",
  title: "Move most of my ETH to Base — and prove it arrived",
  story: "DS4",
  chains: [1, 8453],
  apps: [],
  // BOTH bridge actors, because the agent genuinely picks its own route:
  // the first live takes chose the canonical L1StandardBridge
  // (`depositETHTo`), which the Across filler rightly ignored. Arming the
  // relayer AND the mock sequencer means whichever route the agent takes,
  // the arrival leg happens.
  actors: ["across", "base-native"],
  prompts: [
    "Move most of my ETH over to Base — leave me enough on mainnet to cover gas for a few transactions",
    "That split works — bridge it.",
    "Did it arrive? Check my ETH balance on Base.",
  ],
  moneyShot:
    "The agent reasoning about a gas reserve it was never given; then, one turn later, reading the bridged ETH off Base itself.",
  timeoutMs: 300_000,
  expectsExecution: true,
};

export default scenario;
