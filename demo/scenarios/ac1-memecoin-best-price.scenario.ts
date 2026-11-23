import type { Scenario } from "./types";

/**
 * Memecoin: risk-check a graduated Pump.fun coin, then quote it on Pump's own AMM and on Raydium.
 *
 * Asset-class format: "do @<asset class> at @<venue> and @<venue>, pick the
 * best price". The asset class is a markdown-only skill that loads the named
 * venues and compares them. Nothing is staged and the take needs no wallet: quotes are indicative, as they are for a user
 * who has not connected one yet.
 */
export const scenario: Scenario = {
  id: "ac1-memecoin-best-price",
  title: "Asset class: @memecoin at @pump and @raydium",
  chains: [],
  apps: [],
  prompts: [
    "Buy 0.5 SOL of ANSEM (9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump) as a " +
      "@memecoin at @pump and @raydium, pick the best price. Just compare for " +
      "now, don't buy yet.",
  ],
  moneyShot:
    "A risk check, then two live quotes for the same coin side by side — " +
    "Pump vs Raydium — and the agent naming the better venue.",
  timeoutMs: 420_000,
  expectsExecution: false,
};

export default scenario;
