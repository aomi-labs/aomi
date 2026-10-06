"use client";

import { ApiDrawer, type EndpointDef } from "./ApiDrawer";
import { PreambleDisplay } from "./PreambleDisplay";

const DEFI_ENDPOINTS: EndpointDef[] = [
  // ── DefiLlama — Informational ──────────────────────────────────────────

  {
    label: "Get Token Price",
    method: "GET",
    path: "/prices/current/:coins",
    baseUrl: "https://coins.llama.fi",
    description:
      "Get current token prices from DefiLlama. Coins use the format chain:address (e.g. ethereum:0xdF574...) or coingecko:id (e.g. coingecko:ethereum).",
    params: [
      {
        key: "coins",
        placeholder: "coingecko:ethereum,coingecko:bitcoin",
        required: true,
        defaultValue: "coingecko:ethereum",
      },
      {
        key: "searchWidth",
        placeholder: "Price lookback window (e.g. 4h)",
      },
    ],
  },
  {
    label: "Get Yield Opportunities",
    method: "GET",
    path: "/pools",
    baseUrl: "https://yields.llama.fi",
    description:
      "List DeFi yield pools from DefiLlama sorted by APY. Returns all pools — filter client-side by chain, project, or stablecoin flag.",
    params: [],
  },
  {
    label: "Get DeFi Protocols",
    method: "GET",
    path: "/protocols",
    baseUrl: "https://api.llama.fi",
    description:
      "List all DeFi protocols tracked by DefiLlama with TVL, category, supported chains, and 24h change.",
    params: [],
  },
  {
    label: "Get Chain TVL",
    method: "GET",
    path: "/v2/chains",
    baseUrl: "https://api.llama.fi",
    description:
      "Get current total value locked per chain. Returns all chains ranked by TVL with native token info.",
    params: [],
  },
  {
    label: "Get Bridges",
    method: "GET",
    path: "/bridges",
    baseUrl: "https://bridges.llama.fi",
    description:
      "List cross-chain bridges with 24h and 7d volume data. Useful for comparing bridge liquidity and supported chains.",
    params: [],
  },

  // ── 0x Swap API v2 ────────────────────────────────────────────────────

  {
    label: "Get 0x Swap Quote",
    method: "GET",
    path: "/swap/allowance-holder/price",
    baseUrl: "https://api.0x.org",
    description:
      "Get an indicative swap price from the 0x aggregator. Requires a 0x API key. Use chainId to specify the network.",
    params: [
      {
        key: "chainId",
        placeholder: "1 (Ethereum), 137 (Polygon), 42161 (Arbitrum)",
        required: true,
        defaultValue: "1",
      },
      {
        key: "sellToken",
        placeholder: "Token address to sell (e.g. 0xA0b8...)",
        required: true,
      },
      {
        key: "buyToken",
        placeholder: "Token address to buy",
        required: true,
      },
      {
        key: "sellAmount",
        placeholder: "Amount in base units (wei)",
        required: true,
      },
      {
        key: "taker",
        placeholder: "Taker wallet address (0x-prefixed)",
      },
      {
        key: "slippageBps",
        placeholder: "Slippage in basis points (e.g. 50 = 0.5%)",
      },
    ],
    headers: [
      {
        key: "0x-api-key",
        placeholder: "Your 0x API key (from dashboard.0x.org)",
        required: true,
      },
      {
        key: "0x-version",
        placeholder: "API version",
        defaultValue: "v2",
      },
    ],
  },

  // ── LI.FI API ─────────────────────────────────────────────────────────

  {
    label: "Get LI.FI Quote",
    method: "GET",
    path: "/v1/quote",
    baseUrl: "https://li.quest",
    description:
      "Get a cross-chain or same-chain swap quote from LI.FI. Supports bridging + swapping in a single step. No API key required.",
    params: [
      {
        key: "fromChain",
        placeholder: "Source chain ID or name (e.g. 1, ETH)",
        required: true,
        defaultValue: "1",
      },
      {
        key: "toChain",
        placeholder: "Destination chain ID or name",
        required: true,
        defaultValue: "1",
      },
      {
        key: "fromToken",
        placeholder: "Source token address",
        required: true,
      },
      {
        key: "toToken",
        placeholder: "Destination token address",
        required: true,
      },
      {
        key: "fromAmount",
        placeholder: "Amount in base units (with decimals)",
        required: true,
      },
      {
        key: "fromAddress",
        placeholder: "Sender wallet address",
        required: true,
      },
      {
        key: "toAddress",
        placeholder: "Receiver wallet address (optional)",
      },
      {
        key: "slippage",
        placeholder: "Slippage tolerance (0-1, e.g. 0.005)",
      },
      {
        key: "order",
        placeholder: "FASTEST or CHEAPEST",
      },
    ],
  },

  // ── CoW Protocol ──────────────────────────────────────────────────────

  {
    label: "Get CoW Quote",
    method: "POST",
    path: "/mainnet/api/v1/quote",
    baseUrl: "https://api.cow.fi",
    description:
      "Request a swap quote from CoW Protocol. Change the path segment to target different chains: mainnet, xdai, arbitrum_one, base, polygon.",
    params: [],
    bodyTemplate: JSON.stringify(
      {
        sellToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        buyToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        sellAmountBeforeFee: "1000000000000000000",
        from: "0x...",
        kind: "sell",
        signingScheme: "eip712",
      },
      null,
      2,
    ),
  },
  {
    label: "Place CoW Order",
    method: "POST",
    path: "/mainnet/api/v1/orders",
    baseUrl: "https://api.cow.fi",
    description:
      "Submit a signed order to the CoW Protocol orderbook. Requires a fully-signed EIP-712 payload. Change path for other chains.",
    params: [],
    bodyTemplate: JSON.stringify(
      {
        sellToken: "0x...",
        buyToken: "0x...",
        sellAmount: "1000000000000000000",
        buyAmount: "...",
        validTo: 0,
        feeAmount: "...",
        kind: "sell",
        partiallyFillable: false,
        receiver: "0x...",
        signature: "0x...",
        signingScheme: "eip712",
        from: "0x...",
      },
      null,
      2,
    ),
  },
];

const DEFI_PREAMBLE = `You are **DeFi Master**, an expert AI assistant specialized in decentralized finance.

## Your Capabilities

You help users navigate the DeFi ecosystem with accurate, real-time data:

- **Token Prices** — Get current prices for any cryptocurrency
- **Yield Opportunities** — Find the best staking and farming APYs
- **Swap Quotes** — Get DEX rates for token swaps
- **Protocol TVL** — Analyze top DeFi protocols by value locked
- **Chain TVL** — Compare blockchain activity levels
- **Bridges** — Find cross-chain bridging options

## Data Sources

All data comes from DeFiLlama (free, no API key required):

- Prices: \`coins.llama.fi\`
- Yields: \`yields.llama.fi\`
- TVL: \`api.llama.fi\`

## Common Tokens

- **Major**: ETH, BTC (WBTC), BNB, SOL, AVAX
- **Stablecoins**: USDC, USDT, DAI
- **DeFi**: UNI, AAVE, LINK, MKR, CRV, LDO
- **L2 Tokens**: ARB, OP, MATIC

## Key DeFi Concepts

- **TVL** (Total Value Locked) — Total assets deposited in a protocol
- **APY** vs **APR** — APY includes compounding, APR doesn't
- **IL** (Impermanent Loss) — Risk of providing AMM liquidity

## Response Guidelines

1. Use \`get_token_price\` to check current prices
2. Use \`get_yield_opportunities\` for APY comparison (filter by chain, project, or stablecoin-only)
3. Use \`get_aggregator_swap_quote\` to find best DEX rates
4. Ask the user which aggregator they prefer (0x, LI.FI, CoW). If unspecified, query all.
5. Use \`place_aggregator_evm_order\` to execute 0x/LI.FI orders (simulation first, then wallet send)
6. Use \`place_cow_order\` to submit signed CoW orders to CoW orderbook API
7. Use \`get_defi_protocols\` to explore top protocols by TVL or category
8. Use \`get_chain_tvl\` to see which chains have most DeFi activity
9. Use \`get_bridges\` for cross-chain transfer options

## ERC-20 Approval Before Swap (LI.FI)

When executing swaps via LI.FI using \`place_aggregator_evm_order\`, selling an ERC-20 token (not native ETH) requires sufficient allowance for the LI.FI router. If simulation reverts with \`TRANSFER_FROM_FAILED\`:

1. Use \`encode_and_view\` to call \`allowance(address,address)\` on the sell-token contract
2. If allowance is insufficient, approve the exact router/spender before retrying the swap

## 0x Swap API v2 Approval Rules (AllowanceHolder)

For 0x AllowanceHolder flow, the only approval needed is the AllowanceHolder spender returned by quote/issue data.

### Correct 0x Flow

1. Get quote from \`/swap/allowance-holder/quote\`
2. Check \`issues.allowance\`; if insufficient, approve the returned spender (AllowanceHolder)
3. Execute swap with \`transaction.to\`, \`transaction.data\`, \`transaction.value\` from quote

## Risk Warnings

- High APY often means higher risk — DYOR
- New protocols may have unaudited contracts
- IL can significantly reduce returns in volatile pools
- Bridge hacks have caused billions in losses — use established bridges
- Stablecoin yields are generally safer but not risk-free

## Formatting

- Format prices as USD with appropriate precision ($1,234.56)
- Format TVL in billions ($12.3B) or millions ($456M)
- Format APY with one decimal (12.5%)
- Always mention the chain when discussing yields or protocols
`;

export function DefiConsole() {
  return (
    <div className="space-y-2">
      <ApiDrawer
        defaultBaseUrl="https://api.llama.fi"
        endpoints={DEFI_ENDPOINTS}
      />
      <PreambleDisplay content={DEFI_PREAMBLE} />
    </div>
  );
}
