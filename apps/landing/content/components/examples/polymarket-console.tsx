"use client";

import { ApiDrawer, type EndpointDef } from "./ApiDrawer";
import { PreambleDisplay } from "./PreambleDisplay";

const POLYMARKET_ENDPOINTS: EndpointDef[] = [
  // ── Gamma API (market data) ───────────────────────────────────────────
  {
    label: "Search Markets",
    method: "GET",
    path: "/markets",
    description:
      "Query prediction markets with filtering options. Returns markets with current prices, volumes, liquidity, and metadata.",
    params: [
      { key: "limit", placeholder: "Max results (default: 100, max: 1000)", defaultValue: "100" },
      { key: "offset", placeholder: "Pagination offset", defaultValue: "0" },
      { key: "active", placeholder: "true | false" },
      { key: "closed", placeholder: "true | false" },
      { key: "archived", placeholder: "true | false" },
      { key: "tag", placeholder: "e.g. crypto, sports, politics" },
    ],
  },
  {
    label: "Get Market by Slug",
    method: "GET",
    path: "/markets?slug=:slug",
    description:
      "Fetch a single market by its URL slug.",
    params: [
      {
        key: "slug",
        placeholder: "e.g. will-bitcoin-reach-100k-by-2025",
        required: true,
      },
    ],
  },
  {
    label: "Get Market by ID",
    method: "GET",
    path: "/markets/:conditionId",
    description:
      "Fetch detailed information about a specific market by its condition ID.",
    params: [
      {
        key: "conditionId",
        placeholder: "Condition ID (0x-prefixed hash)",
        required: true,
      },
    ],
  },

  // ── Data API (trades) ─────────────────────────────────────────────────
  {
    label: "Get Trades",
    method: "GET",
    path: "/trades",
    baseUrl: "https://data-api.polymarket.com",
    description:
      "Retrieve historical trades. Returns trade history with timestamps, prices, sizes, and user information.",
    params: [
      { key: "limit", placeholder: "Max results (default: 100, max: 10000)", defaultValue: "100" },
      { key: "offset", placeholder: "Pagination offset", defaultValue: "0" },
      { key: "market", placeholder: "Market condition ID (comma-separated)" },
      { key: "user", placeholder: "Wallet address (0x-prefixed)" },
      { key: "side", placeholder: "BUY | SELL" },
    ],
  },

  // ── CLOB API (orders) ─────────────────────────────────────────────────
  {
    label: "Get Order Book",
    method: "GET",
    path: "/book",
    baseUrl: "https://clob.polymarket.com",
    description:
      "Fetch the current order book for a token. Returns bids and asks with prices and sizes.",
    params: [
      { key: "token_id", placeholder: "Token ID (outcome token)", required: true },
    ],
  },
  {
    label: "Place Order",
    method: "POST",
    path: "/orders",
    baseUrl: "https://clob.polymarket.com",
    description:
      "Submit a signed order to the CLOB. Requires a wallet-signed EIP-712 payload with order parameters.",
    params: [],
    headers: [
      { key: "POLY_ADDRESS", placeholder: "Wallet address (0x-prefixed)", required: true },
      { key: "POLY_SIGNATURE", placeholder: "L2 HMAC signature", required: true },
      { key: "POLY_TIMESTAMP", placeholder: "Unix timestamp", required: true },
      { key: "POLY_API_KEY", placeholder: "CLOB API key", required: true },
      { key: "POLY_PASSPHRASE", placeholder: "CLOB passphrase", required: true },
    ],
    bodyTemplate: JSON.stringify(
      {
        order: {
          tokenID: "...",
          side: "BUY",
          size: "50.0",
          price: "0.65",
          feeRateBps: "0",
          nonce: "0",
          expiration: "0",
          taker: "0x0000000000000000000000000000000000000000",
        },
        owner: "0x...",
        orderType: "GTC",
      },
      null,
      2,
    ),
  },
];

const POLYMARKET_PREAMBLE = `## Polymarket

You also specialize in Polymarket prediction markets — discovering markets, analyzing trends, and placing trades.

## Popular Tags

- **Politics & Elections:** election 2026, donald trump, kamala harris, electoral votes
- **Crypto & Web3:** Bitcoin Conference, Stablecoins, DJT, blast, celestia, eigenlayer
- **Sports:** EPL, MLS Cup, NCAA, CFB, Cricket, Wimbledon
- **International:** European Union, ukraine, russia, china
- **Economics:** stock market, crude oil, recession, gdp
- **Technology:** ai technology, anthropic

## Polymarket Basics

- Prices are probabilities (0.65 = 65%). Markets resolve to $1 (Yes) or $0 (No).
- Higher volume/liquidity = more reliable markets.

## Trading Flow

1. \`resolve_polymarket_trade_intent\` — match request to candidate markets; if ambiguous, ask user to pick
2. \`build_polymarket_order_preview\` — resolve token_id/price/size; show preview, require confirmation
3. \`get_polymarket_clob_signature\` — build ClobAuth EIP-712 typed data, send to wallet; returns Signed or PendingApproval
4. \`ensure_polymarket_clob_credentials\` — pass exact same address/timestamp/nonce + signature from step 3; returns api_key/secret/passphrase
5. \`place_polymarket_order\` — submit with clob_auth credentials; requires confirmation='confirm'

## Polymarket Rules

- Never skip the preview step or place orders without explicit user confirmation
- If step 3 returns PendingApproval, wait for wallet signature before calling step 4
- L1 auth values (address, timestamp, nonce) in step 4 must be identical to what was signed in step 3
- You have tool access to Polymarket CLOB HTTP APIs; never claim clob.polymarket.com is inaccessible.
`;

export function PolymarketConsole() {
  return (
    <div className="space-y-2">
      <ApiDrawer
        defaultBaseUrl="https://gamma-api.polymarket.com"
        endpoints={POLYMARKET_ENDPOINTS}
      />
      <PreambleDisplay content={POLYMARKET_PREAMBLE} />
    </div>
  );
}
