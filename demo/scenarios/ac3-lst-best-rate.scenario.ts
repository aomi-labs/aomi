import type { Scenario } from "./types";

/**
 * Liquid staking tokens: SOL into JitoSOL quoted through Sanctum and through Jupiter's market route.
 *
 * Asset-class format: "do @<asset class> at @<venue> and @<venue>, pick the
 * best price". The asset class is a markdown-only skill that loads the named
 * venues and compares them. Nothing is staged and the take needs no wallet: quotes are indicative, as they are for a user
 * who has not connected one yet.
 */
export const scenario: Scenario = {
  id: "ac3-lst-best-rate",
  title: "Asset class: @lst at @sanctum and @jupiter",
  chains: [],
  apps: [],
  prompts: [
    "Swap 1 SOL into JitoSOL as an @lst at @sanctum and @jupiter, best rate. " +
      "Just compare for now, don't stake yet.",
  ],
  moneyShot:
    "Two routes into the same LST, compared by tokens out and SOL value, " +
    "with the better rate named.",
  timeoutMs: 420_000,
  expectsExecution: false,
};

export default scenario;
