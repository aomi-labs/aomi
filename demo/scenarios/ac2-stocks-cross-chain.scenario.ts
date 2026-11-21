import type { Scenario } from "./types";

/**
 * Tokenized stocks across chains: Apple from xStocks and Ondo on Solana against Robinhood Stock Tokens on Robinhood Chain, per underlying share.
 *
 * Asset-class format: "do @<asset class> at @<venue> and @<venue>, pick the
 * best price". The asset class is a markdown-only skill that loads the named
 * venues and compares them. Nothing is staged and the take needs no wallet: quotes are indicative, as they are for a user
 * who has not connected one yet.
 */
export const scenario: Scenario = {
  id: "ac2-stocks-cross-chain",
  title: "Asset class: @stocks across xStocks, Ondo and Robinhood",
  chains: [],
  apps: [],
  prompts: [
    "Buy $50 of Apple as @stocks at @xstocks, @ondo and @robinhood, " +
      "pick the best price per share. Just compare for now, don't buy yet.",
  ],
  moneyShot:
    "One table, three issuers, two chains: AAPLx, AAPLon and Robinhood's " +
    "AAPL priced per underlying share, with the winner named.",
  mentions: { xstocks: "xStocks", robinhood: "Robinhood Stocks" },
  timeoutMs: 420_000,
  expectsExecution: false,
};

export default scenario;
