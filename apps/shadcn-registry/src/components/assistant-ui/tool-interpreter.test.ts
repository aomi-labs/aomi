import { describe, expect, it } from "vitest";
import {
  BracesIcon,
  CoinsIcon,
  FileTextIcon,
  GlobeIcon,
  LandmarkIcon,
  NetworkIcon,
  PencilLineIcon,
  PercentIcon,
  PuzzleIcon,
  SearchIcon,
  TagIcon,
} from "lucide-react";

import { interpretToolStep } from "@/components/assistant-ui/tool-interpreter";
import { formatTokenUnits } from "@/components/assistant-ui/tool-interpreter/token-registry";
import { statusFact } from "@/components/assistant-ui/tool-interpreter/normalize";
import { getSkillIcon } from "@/components/icons/skills";

const labelsFor = (chips: { label: string }[]) =>
  chips.map((chip) => chip.label);

describe("tool interpreter", () => {
  it("formats token units without losing bigint precision", () => {
    expect(formatTokenUnits("123456789012345678901234", 6)).toBe(
      "123456789012345678.901234",
    );
  });

  it("does not treat inherited status table names as known states", () => {
    expect(statusFact("constructor")).toEqual({
      kind: "status",
      value: "constructor",
      label: "Constructor",
      source: "result",
    });
  });

  it("shows legacy web search result domains", () => {
    const step = interpretToolStep({
      toolName: "brave_search",
      result: {
        args: [
          "Found 3 results:",
          "",
          "1. ETHUSD - Ethereum Price Chart - TradingView",
          "   URL: https://www.tradingview.com/symbols/ETHUSD/",
          "2. Ethereum price today",
          "   URL: https://coinmarketcap.com/currencies/ethereum/",
        ].join("\n"),
      },
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual([
      "tradingview.com",
      "coinmarketcap.com",
    ]);
    expect(step.chips.every((chip) => chip.icon === GlobeIcon)).toBe(true);
  });

  it("wraps plain text results before matching", () => {
    const step = interpretToolStep({
      toolName: "brave_search",
      result: [
        "Found 2 results:",
        "",
        "1. ETHUSD - Ethereum Price Chart - TradingView",
        "   URL: https://www.tradingview.com/symbols/ETHUSD/",
      ].join("\n"),
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual(["tradingview.com"]);
  });

  it("shows the top three unique web_search result domains", () => {
    const result = (url: string, host?: string) => ({
      title: "Result",
      url,
      ...(host ? { host } : {}),
      snippet: "…",
    });
    const step = interpretToolStep({
      toolName: "web_search",
      argsText: JSON.stringify({ topic: "eth", query: "eth price" }),
      result: {
        query: "eth price",
        provider: "firecrawl",
        results: [
          result("https://www.coindesk.com/a", "coindesk.com"),
          result("https://WWW.CoinDesk.com/b"),
          result("https://docs.base.org/x", "WWW.Docs.Base.org"),
          result("https://www.theblock.co/y"),
          result("https://decrypt.co/z", "decrypt.co"),
        ],
      },
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual([
      "coindesk.com",
      "docs.base.org",
      "theblock.co",
    ]);
    expect(step.chips.every((chip) => chip.icon === GlobeIcon)).toBe(true);
  });

  it("shows the query while a web search is pending", () => {
    const query = "latest ethereum pectra upgrade activation date on mainnet";
    const step = interpretToolStep({
      toolName: "web_search",
      argsText: JSON.stringify({ topic: "eth", query, limit: 5 }),
    });

    expect(step.title).toBe("Search web");
    expect(step.chips).toHaveLength(1);
    expect(step.chips[0]).toMatchObject({
      label: "latest ethereum pectra upgrade…",
      title: query,
      icon: SearchIcon,
    });
  });

  it("keeps the query chip when a web search finds nothing", () => {
    const step = interpretToolStep({
      toolName: "web_search",
      argsText: JSON.stringify({ topic: "x", query: "zzqx token" }),
      result: {
        query: "zzqx token",
        provider: "brave",
        results: [],
        note: "No web results found.",
      },
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual(["zzqx token"]);
  });

  it("shows the query for docs search text results", () => {
    const step = interpretToolStep({
      toolName: "search_docs",
      argsText: JSON.stringify({ query: "swap router" }),
      result: "[V3 Docs] SwapRouter (0.82)\nExact input swaps…",
    });

    expect(step.title).toBe("Search docs");
    expect(labelsFor(step.chips)).toEqual(["swap router"]);
  });

  it("shows the host web_fetch actually read after redirects", () => {
    const step = interpretToolStep({
      toolName: "web_fetch",
      argsText: JSON.stringify({ topic: "docs", url: "https://t.co/abc" }),
      result: {
        url: "https://t.co/abc",
        final_url: "https://www.example.org/post",
        host: "example.org",
        title: "Post",
        content: "…",
        truncated: false,
        provider: "direct",
      },
    });

    expect(step.title).toBe("Read page");
    expect(step.icon).toBe(FileTextIcon);
    expect(labelsFor(step.chips)).toEqual(["example.org"]);
    expect(step.chips[0].icon).toBe(GlobeIcon);

    const withoutHost = interpretToolStep({
      toolName: "web_fetch",
      result: {
        url: "https://t.co/abc",
        final_url: "https://www.example.org/post",
      },
    });
    expect(labelsFor(withoutHost.chips)).toEqual(["example.org"]);
  });

  it("shows the requested host while web_fetch is pending", () => {
    const step = interpretToolStep({
      toolName: "web_fetch",
      argsText: JSON.stringify({
        topic: "docs",
        url: "https://www.docs.uniswap.org/sdk",
      }),
    });

    expect(step.title).toBe("Read page");
    expect(labelsFor(step.chips)).toEqual(["docs.uniswap.org"]);
  });

  it("shows LI.FI bridge source, destination, and durable status", () => {
    const quote = interpretToolStep({
      toolName: "lifi_get_quote",
      result: {
        quote_id: "quote-1",
        chain_id: 8453,
        source_chain_id: 8453,
        destination_chain_id: 42161,
        from_token: { symbol: "USDC" },
        to_token: { symbol: "USDC" },
        from_amount: { display: "2 USDC" },
        estimate: { to_amount_display: "1.9 USDC" },
      },
    });
    expect(quote.title).toBe("Quote LI.FI bridge");
    expect(labelsFor(quote.chips)).toContain("Base → Arbitrum");

    const preparation = interpretToolStep({
      toolName: "lifi_prepare_swap_batch",
      argsText: JSON.stringify({
        chain_id: 8453,
        to_chain_id: 42161,
        from_token: "USDC",
        amount: "2",
      }),
      result: {
        source_chain_id: 8453,
        destination_chain_id: 42161,
        from_token: { symbol: "USDC" },
        to_token: { symbol: "USDC" },
      },
    });
    expect(preparation.title).toBe("Prepare LI.FI bridge");
    expect(labelsFor(preparation.chips)).toContain("Base → Arbitrum");

    const status = interpretToolStep({
      toolName: "lifi_get_status",
      result: {
        commit_id: "commit-1",
        source_chain_id: 8453,
        destination_chain_id: 42161,
        state: "partial",
      },
    });
    expect(status.title).toBe("Check LI.FI transfer");
    expect(labelsFor(status.chips)).toEqual(["Base → Arbitrum", "Partial"]);
    expect(status.outcome).toBe("incomplete");
  });

  it("shows requested DefiLlama price tokens while the lookup is pending", () => {
    const step = interpretToolStep({
      toolName: "defillama_prices",
      argsText: JSON.stringify({
        topic: "Price tokens",
        tokens: [
          "ETH",
          "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "coingecko:ethereum",
        ],
        chain: "8453",
        at: null,
        change_period: null,
      }),
    });

    expect(step.title).toBe("Check prices");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "ETH",
      "0x8335…2913",
      "ethereum",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBe(CoinsIcon);
  });

  it("shows up to three compact DefiLlama prices", () => {
    const step = interpretToolStep({
      toolName: "defillama_prices",
      argsText: JSON.stringify({ tokens: ["ETH"], at: "2025-01-01" }),
      result: {
        source: "defillama",
        chain_id: 56,
        chain_name: "BSC",
        prices: [
          { query: "ETH", symbol: "ETH", price_usd: 2689.42 },
          { query: "USDC", symbol: "USDC", price_usd: 0.99987 },
          { query: "PEPE", symbol: "PEPE", price_usd: 0.0000123456 },
          { query: "WBTC", symbol: "WBTC", price_usd: 64000 },
        ],
        unresolved: [],
      },
    });

    expect(step.title).toBe("Check historical prices");
    expect(labelsFor(step.chips)).toEqual([
      "BSC",
      "ETH $2,689",
      "USDC $0.9999",
      "PEPE $0.00001235",
    ]);
    // Chains without a mark keep a generic network icon.
    expect(step.chips[0].icon).toBe(NetworkIcon);
  });

  it("keeps unresolved DefiLlama prices neutral", () => {
    const step = interpretToolStep({
      toolName: "defillama_prices",
      argsText: JSON.stringify({ tokens: ["FOO"] }),
      result: {
        source: "defillama",
        prices: [],
        unresolved: [{ query: "FOO", hint: "Use chain:address" }],
      },
    });

    expect(labelsFor(step.chips)).toEqual(["FOO", "1 not found"]);
    expect(step.failed).toBe(false);

    const failed = interpretToolStep({
      toolName: "defillama_prices",
      argsText: JSON.stringify({ tokens: ["FOO"] }),
      result: { error: "DefiLlama unavailable" },
    });
    expect(failed.title).toBe("Check prices");
    expect(labelsFor(failed.chips)).toEqual(["FOO", "Failed"]);
    expect(failed.failed).toBe(true);
  });

  it("shows DefiLlama yield filters, then the top pool and match count", () => {
    const args = JSON.stringify({
      asset: "USDC",
      chain: "base",
      protocol: "aave-v3",
      kind: "lend",
      pool_id: null,
    });
    const pending = interpretToolStep({
      toolName: "defillama_find_yields",
      argsText: args,
    });
    expect(pending.title).toBe("Find yields");
    expect(labelsFor(pending.chips)).toEqual([
      "Base",
      "USDC",
      "Lending",
      "aave-v3",
    ]);
    expect(pending.chips[2].icon).toBe(TagIcon);
    expect(pending.chips[3].icon).toBe(LandmarkIcon);

    const step = interpretToolStep({
      toolName: "defillama_find_yields",
      argsText: args,
      result: {
        source: "defillama",
        chain_id: 8453,
        chain_name: "Base",
        asset: "USDC",
        kind: "lend",
        total_matches: 12,
        results: [
          {
            pool_id: "pool-1",
            protocol: "Aave V3",
            project: "aave-v3",
            chain: "Base",
            symbol: "USDC",
            apy: 4.1372,
          },
        ],
      },
    });
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC",
      "Lending",
      "Aave V3 4.14%",
      "12 pools",
    ]);
    expect(step.chips[3].icon).toBe(PercentIcon);
  });

  it("titles a DefiLlama pool lookup from its own result", () => {
    const step = interpretToolStep({
      toolName: "defillama_find_yields",
      argsText: JSON.stringify({ pool_id: "pool-2" }),
      result: {
        source: "defillama",
        total_matches: 1,
        results: [
          {
            pool_id: "pool-2",
            protocol: "Lido",
            chain: "Ethereum",
            chain_id: 1,
            symbol: "STETH",
            apy: 2.9,
          },
        ],
      },
    });

    expect(step.title).toBe("Check yield pool");
    expect(labelsFor(step.chips)).toEqual(["Ethereum", "STETH", "Lido 2.9%"]);
  });

  it("titles DefiLlama protocol searches by mode", () => {
    const lookup = interpretToolStep({
      toolName: "defillama_find_protocols",
      argsText: JSON.stringify({ query: "aave", chain: null }),
    });
    expect(lookup.title).toBe("Look up protocol");
    expect(labelsFor(lookup.chips)).toEqual([]);

    const found = interpretToolStep({
      toolName: "defillama_find_protocols",
      argsText: JSON.stringify({ query: "aave", chain: null }),
      result: {
        source: "defillama",
        mode: "lookup",
        query: "aave",
        results: [
          { name: "Aave V3", slug: "aave-v3" },
          { name: "Aave V4", slug: "aave-v4" },
        ],
      },
    });
    expect(labelsFor(found.chips)).toEqual(["Aave V3", "Aave V4"]);

    const overview = interpretToolStep({
      toolName: "defillama_find_protocols",
      argsText: JSON.stringify({ chain: "solana" }),
      result: {
        source: "defillama",
        mode: "chain_overview",
        chain: { name: "Solana", tvl_usd: 9e9 },
        categories: [
          {
            category: "Lending",
            protocols: [{ name: "Kamino", slug: "kamino", tvl_usd: 2e9 }],
          },
          {
            category: "Liquid Staking",
            protocols: [{ name: "Jito", slug: "jito", tvl_usd: 3e9 }],
          },
        ],
      },
    });
    expect(overview.title).toBe("Scan chain");
    expect(labelsFor(overview.chips)).toEqual(["Solana", "Jito", "Kamino"]);
    expect(overview.chips[0].icon).toBe(NetworkIcon);
    expect(overview.chips[1].icon).toBe(LandmarkIcon);

    const list = interpretToolStep({
      toolName: "defillama_find_protocols",
      argsText: JSON.stringify({ category: "Dexs", chain: "base" }),
      result: {
        source: "defillama",
        mode: "list",
        chain_id: 8453,
        chain_name: "Base",
        category: "Dexs",
        results: [
          { name: "Aerodrome", slug: "aerodrome", category: "Dexs" },
          { name: "Uniswap V3", slug: "uniswap-v3", category: "Dexs" },
          { name: "Curve DEX", slug: "curve-dex", category: "Dexs" },
        ],
      },
    });
    expect(list.title).toBe("Find protocols");
    expect(labelsFor(list.chips)).toEqual([
      "Base",
      "Dexs",
      "Aerodrome",
      "Uniswap V3",
    ]);
  });

  it("unwraps routed tool envelopes before matching", () => {
    const step = interpretToolStep({
      toolName: "get_time_and_onchain_context",
      result: {
        __aomi_tool_routes: [{ id: "route-1" }],
        value: {
          chain_name: "base",
          chain_id: 8453,
          rpc_endpoint: "http://127.0.0.1:56293",
          block_number: 48317939,
        },
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Base", "48,317,939"]);
  });

  it("shows the synced network before its block number", () => {
    const step = interpretToolStep({
      toolName: "sync_chain",
      argsText: JSON.stringify({ chain_id: 42161 }),
      result: { chain_id: 42161, synced: true, block_number: 509848804 },
    });

    expect(step.title).toBe("Sync network");
    expect(labelsFor(step.chips)).toEqual(["Arbitrum", "509,848,804"]);
    expect(step.chips.every((chip) => chip.icon != null)).toBe(true);

    const pending = interpretToolStep({
      toolName: "sync_chain",
      argsText: JSON.stringify({ chain_id: 42161 }),
    });
    expect(labelsFor(pending.chips)).toEqual(["Arbitrum"]);
  });

  it("keeps EVM argument chips from hiding tool failures", () => {
    for (const [toolName, args] of [
      ["sync_chain", { chain_id: 42161 }],
      ["get_contract", { chain_id: 42161, contract_type: "Aave Pool" }],
      [
        "encode_and_call",
        { chain_id: 42161, function_signature: "withdraw()" },
      ],
    ] as const) {
      const step = interpretToolStep({
        toolName,
        argsText: JSON.stringify(args),
        result: { is_error: true, error: "rpc_error" },
      });
      expect(step.failed).toBe(true);
      expect(labelsFor(step.chips)).toEqual(["Failed"]);
    }
  });

  it("keeps unrecognized tools neutral even with chain-like arguments", () => {
    const step = interpretToolStep({
      toolName: "Check USDC",
      argsText: JSON.stringify({ chain_id: 8453 }),
    });

    expect(step.title).toBe("Check USDC");
    expect(labelsFor(step.chips)).toEqual([]);
    expect(step.confidence).toBe("fallback");
  });

  it("surfaces error results with normalized status chips", () => {
    const step = interpretToolStep({
      toolName: "Call token contract",
      result: {
        is_error: true,
        error: { code: "rpc_error" },
      },
    });

    expect(step.title).toBe("Call token contract");
    expect(labelsFor(step.chips)).toEqual(["Failed"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
    expect(step.failed).toBe(true);
  });

  it("keeps exact transaction tool titles semantic while active and failed", () => {
    const activeStage = interpretToolStep({
      toolName: "evm_stage_tx",
      argsText: JSON.stringify({ chain_id: 8453, kind: "native_transfer" }),
    });
    const failedSimulation = interpretToolStep({
      toolName: "simulate_batch",
      argsText: JSON.stringify({ tx_ids: [1] }),
      result: { is_error: true, error: "fork unavailable" },
      relatedResults: [
        { pending_tx_id: 1, chain_id: 8453, current_lifecycle: "queued" },
      ],
    });

    expect(activeStage.title).toBe("Stage transaction");
    expect(labelsFor(activeStage.chips)).toEqual(["Base", "Native transfer"]);
    expect(failedSimulation.title).toBe("Simulate transaction");
    expect(labelsFor(failedSimulation.chips)).toEqual([
      "Base",
      "1 tx",
      "Failed",
    ]);
    expect(failedSimulation.failed).toBe(true);
  });

  it("uses only the requested transaction context for commit badges", () => {
    const relatedResults = [
      { pending_tx_id: 1, chain_id: 1, current_lifecycle: "queued" },
      { pending_tx_id: 2, chain_id: 8453, current_lifecycle: "queued" },
    ];
    const active = interpretToolStep({
      toolName: "evm_commit_txs",
      argsText: JSON.stringify({ tx_ids: [2] }),
      relatedResults,
    });
    const ambiguous = interpretToolStep({
      toolName: "evm_commit_txs",
      argsText: JSON.stringify({ tx_ids: [1, 2] }),
      result: { is_error: true, error: "mixed chains" },
      relatedResults,
    });

    expect(active.title).toBe("Commit transactions");
    expect(labelsFor(active.chips)).toEqual([
      "Base",
      "1 tx",
      "Pending confirmation",
    ]);
    expect(labelsFor(ambiguous.chips)).toEqual(["2 txs", "Failed"]);
  });

  it("keeps completed commit results under the same semantic title", () => {
    const step = interpretToolStep({
      toolName: "evm_commit_txs",
      argsText: JSON.stringify({ tx_ids: [7] }),
      result: { status: "confirmed", tx_hashes: ["0xabc"] },
      relatedResults: [
        { pending_tx_id: 7, chain_id: 8453, current_lifecycle: "queued" },
      ],
    });

    expect(step.title).toBe("Commit transactions");
    expect(labelsFor(step.chips)).toEqual(["Base", "1 tx", "Confirmed"]);
    expect(step.failed).toBe(false);
  });

  it("recognizes skill activation", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: {
        activated: ["aerodrome"],
        rejected: [["common_erc20", "token_budget_trim"]],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate skill");
    expect(labelsFor(step.chips)).toEqual(["Aerodrome"]);
    expect(step.chips[0].icon).toBe(getSkillIcon("aerodrome"));
    expect(step.chips[0].icon).not.toBe(PuzzleIcon);
    expect(step.chips[0].icon).not.toBe(step.icon);
    expect(step.failed).toBe(false);
  });

  it("uses the display name for LI.FI skill activation", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: {
        activated: ["common_erc20", "lifi_swap"],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate skill");
    expect(labelsFor(step.chips)).toEqual(["ERC20", "LI.FI"]);
    expect(step.chips[0].icon).toBe(getSkillIcon("common_erc20"));
    expect(step.chips[1].icon).toBe(getSkillIcon("lifi_swap"));
  });

  it("shows active skills on a check without an empty placeholder badge", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: {
        activated: [],
        rejected: [],
        applied_scope: "thread",
        active_skill_ids: ["aave", "common_erc20", "lifi_swap"],
      },
    });

    expect(step.title).toBe("Check active skills");
    expect(labelsFor(step.chips)).toEqual(["Aave", "ERC20", "LI.FI"]);
    expect(step.chips[0].icon).toBe(getSkillIcon("aave"));
    expect(step.failed).toBe(false);

    const noActiveSkills = interpretToolStep({
      toolName: "activate_skills",
      result: { activated: [], active_skill_ids: [] },
    });
    expect(noActiveSkills.title).toBe("Check active skills");
    expect(noActiveSkills.chips).toEqual([]);
  });

  it("shows the requested or elapsed sleep duration in seconds", () => {
    const pending = interpretToolStep({
      toolName: "sleep",
      argsText: JSON.stringify({ seconds: 12.5 }),
    });
    expect(pending.title).toBe("Sleep");
    expect(labelsFor(pending.chips)).toEqual(["12.5 sec"]);

    const completed = interpretToolStep({
      toolName: "sleep",
      argsText: JSON.stringify({ seconds: 12.5 }),
      result: { status: "completed", slept_seconds: 12.5 },
    });
    expect(labelsFor(completed.chips)).toEqual(["12.5 sec"]);
  });

  it("shows LI.FI quote chain, amounts, and token direction", () => {
    const step = interpretToolStep({
      toolName: "lifi_get_quote",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        chain_id: 8453,
        from_token: {
          symbol: "USDC",
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          decimals: 6,
          chain_id: 8453,
          name: "USD Coin",
          is_native: false,
        },
        to_token: {
          symbol: "ETH",
          address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          decimals: 18,
          chain_id: 8453,
          name: "Native token",
          is_native: true,
        },
        from_amount: {
          raw: "50000",
          display: "0.05 USDC",
        },
        estimate: {
          to_amount_raw: "28514600000000",
          to_amount_display: "0.0000285146 ETH",
          to_amount_min_raw: "28372100000000",
          to_amount_min_display: "0.0000283721 ETH",
          slippage_bps: 50,
        },
      },
    });

    expect(step.title).toBe("Quote LI.FI swap");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC -> ETH",
      "0.05 USDC",
      "0.00003 ETH",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("shows LI.FI approval chain from nested token metadata", () => {
    const step = interpretToolStep({
      toolName: "lifi_prepare_approval_tx",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        approval_required: true,
        current_allowance: "0",
        required_allowance: "50000",
        approval: {
          spender: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
          token: {
            symbol: "USDC",
            address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            decimals: 6,
            chain_id: 8453,
          },
          amount_raw: "50000",
          amount: {
            raw: "50000",
            display: "0.05 USDC",
          },
          policy: "exact",
        },
      },
    });

    expect(step.title).toBe("Prepare LI.FI approval");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC", "0.05 USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
  });

  it("shows Lifi instead of LI for LI.FI swap prep", () => {
    const step = interpretToolStep({
      toolName: "lifi_prepare_swap_tx",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        chain_id: 8453,
        from_token: {
          symbol: "USDC",
          chain_id: 8453,
        },
        to_token: {
          symbol: "ETH",
          chain_id: 8453,
        },
        from_amount: {
          raw: "50000",
          display: "0.05 USDC",
        },
        estimate: {
          to_amount_display: "0.0000285146 ETH",
        },
        stage_tx: {
          to: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
          data: { raw: "0xabcdef" },
          value: "0",
          kind: "lifi_swap",
        },
      },
    });

    expect(step.title).toBe("Prepare LI.FI swap");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC -> ETH",
      "0.05 USDC",
      "0.00003 ETH",
    ]);
  });

  it("shows the Arc chain first and swap chips for a prepared LI.FI batch", () => {
    const input = {
      toolName: "lifi_prepare_swap_batch",
      argsText: JSON.stringify({
        chain_id: 5042,
        from_token: "USDC",
        to_token: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1",
        amount: "5",
      }),
    };

    expect(labelsFor(interpretToolStep(input).chips)).toEqual([
      "Arc",
      "USDC -> 0xbef5…21c1",
      "5 USDC",
    ]);

    const step = interpretToolStep({
      ...input,
      result: {
        quote_id: "lifi_arc_eurc",
        from_token: { symbol: "USDC", chain_id: 5042 },
        to_token: { symbol: "EURC", chain_id: 5042 },
        from_amount: { raw: "5000000", display: "5 USDC" },
        estimate: { to_amount_display: "4.385775 EURC" },
        route: {
          steps: [
            {
              tool: "fly",
              from_chain_id: 5042,
              to_chain_id: 5042,
            },
          ],
        },
        stage_txs: [{ kind: "erc20_approve" }, { kind: "lifi_swap" }],
      },
    });

    expect(step.title).toBe("Prepare LI.FI swap batch");
    expect(labelsFor(step.chips)).toEqual([
      "Arc",
      "USDC -> EURC",
      "5 USDC",
      "4.38578 EURC",
    ]);
  });

  it("keeps LI.FI tool titles and failure state on pending or failed calls", () => {
    const cases = [
      ["lifi_get_quote", "Quote LI.FI swap"],
      ["lifi_prepare_approval_tx", "Prepare LI.FI approval"],
      ["lifi_prepare_swap_tx", "Prepare LI.FI swap"],
      ["lifi_prepare_swap_batch", "Prepare LI.FI swap batch"],
      ["lifi_get_status", "Check LI.FI transfer"],
    ] as const;

    for (const [toolName, title] of cases) {
      const pending = interpretToolStep({ toolName });
      expect(pending.title).toBe(title);

      const failed = interpretToolStep({
        toolName,
        result: {
          error: { code: "tool_call_failed", message: "Unavailable" },
        },
      });
      expect(failed.title).toBe(title);
      expect(failed.outcome).toBe("failed");
      expect(labelsFor(failed.chips)).toEqual(["Failed"]);
    }
  });

  it("keeps a failed LI.FI bridge batch's requested route and amount", () => {
    const step = interpretToolStep({
      toolName: "lifi_prepare_swap_batch",
      argsText: JSON.stringify({
        chain_id: 42161,
        to_chain_id: 8453,
        from_token: "USDC",
        to_token: "USDC",
        amount: "2.98432",
      }),
      result: {
        error: {
          code: "tool_call_failed",
          message: "Affordability check failed",
        },
      },
    });

    expect(step.title).toBe("Prepare LI.FI bridge");
    expect(labelsFor(step.chips)).toEqual([
      "Arbitrum → Base",
      "USDC -> USDC",
      "2.98432 USDC",
      "Failed",
    ]);
    expect(step.outcome).toBe("failed");
  });

  it("recognizes Base chain context", () => {
    const step = interpretToolStep({
      toolName: "get_time_and_onchain_context",
      result: {
        chain_name: "base",
        chain_id: 8453,
        rpc_endpoint: "http://127.0.0.1:56293",
        block_number: 48314732,
        gas_price_wei: "1004545855",
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Base", "48,314,732"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("shows Solana cluster and slot separately from EVM context", () => {
    const step = interpretToolStep({
      toolName: "svm_get_context",
      result: {
        cluster: "mainnet-beta",
        rpc_endpoint: "https://api.mainnet-beta.solana.com",
        supported_clusters: ["devnet", "localnet", "mainnet-beta", "testnet"],
        current_slot: 433493809,
        latest_blockhash: "3SJGv7ovUNSNLB83ZceNiyJBMRVttk7YxcojzYLBTEErg",
        address: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        lamports: 29425461,
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Solana", "433,493,809"]);
    expect(step.confidence).toBe("high");
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("shows the visible SPL amount and known token symbol", () => {
    const step = interpretToolStep({
      toolName: "svm_get_token_holdings",
      result: {
        cluster: "mainnet-beta",
        owner: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        program_id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        accounts: [
          {
            pubkey: "6cSHGy5AjHEeqwema69qBVz1mMmk5MKUyztLJqqPQmPd",
            account: {
              data: {
                program: "spl-token",
                parsed: {
                  info: {
                    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    tokenAmount: {
                      amount: "148008",
                      decimals: 6,
                      uiAmount: 0.148008,
                      uiAmountString: "0.148008",
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });

    expect(step.title).toBe("Get holdings");
    expect(labelsFor(step.chips)).toEqual(["0.148008 USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
    expect(step.confidence).toBe("high");
  });

  it("shows the visible SPL amount without inventing an unknown symbol", () => {
    const step = interpretToolStep({
      toolName: "svm_get_token_holdings",
      result: {
        cluster: "mainnet-beta",
        owner: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        holdings: [
          {
            mint: "UnknownMint111111111111111111111111111111111",
            amount: "123456",
            decimals: 6,
            ui_amount_string: "0.123456",
          },
        ],
        accounts: [],
      },
    });

    expect(labelsFor(step.chips)).toEqual(["0.123456"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
  });

  it("shows Jupiter input, output, and token direction like LI.FI", () => {
    const step = interpretToolStep({
      toolName: "jupiter_prepare_swap",
      result: {
        ix_ids: [7, 8, 9],
        version: "v0",
        address_lookup_tables: ["ALT111111111111111111111111111111111111111"],
        quote: {
          input_token: {
            symbol: "SOL",
            name: "Wrapped SOL",
            mint: "So11111111111111111111111111111111111111112",
            decimals: 9,
            verified: true,
          },
          output_token: {
            symbol: "USDC",
            name: "USD Coin",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            decimals: 6,
            verified: true,
          },
          input: { raw: "1000000", display: "0.001 SOL" },
          expected_output: { raw: "73903", display: "0.073903 USDC" },
          minimum_output: { raw: "73534", display: "0.073534 USDC" },
          slippage_bps: 50,
          context_slot: 433493809,
        },
      },
    });

    expect(step.title).toBe("Prepare swap");
    expect(labelsFor(step.chips)).toEqual([
      "Solana",
      "SOL → USDC",
      "0.001 SOL",
      "0.073903 USDC",
    ]);
    expect(step.confidence).toBe("high");
  });

  it("does not attribute a prior tool's chain to a native balance", () => {
    const step = interpretToolStep({
      toolName: "get_account_info",
      result: {
        address: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance_wei: "865899754337366",
        balance_eth: "0.000865899754337366",
        nonce: 594,
      },
      relatedResults: [{ chain_id: 8453, chain_name: "base" }],
    });

    expect(step.title).toBe("Get account details");
    expect(labelsFor(step.chips)).toEqual(["0xda65...3cf0", "0.00087 ETH"]);
    expect(step.chips[1].icon).toBe(CoinsIcon);
  });

  it("shows the native balance chain when its own arguments expose it", () => {
    const step = interpretToolStep({
      toolName: "get_account_info",
      argsText: JSON.stringify({ chain_id: 8453 }),
      result: {
        address: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance_eth: "0.000865899754337366",
      },
      relatedResults: [{ chain_id: 1 }],
    });

    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xda65...3cf0",
      "0.00087 ETH",
    ]);
  });

  it("shows Arc native USDC balance from the account details result", () => {
    const step = interpretToolStep({
      toolName: "get_account_info",
      argsText: JSON.stringify({ chain_id: 5042 }),
      result: {
        address: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance_wei: "126818805954291600000",
        balance_native: "126.8818059542916",
        native_currency: "USDC",
        nonce: 24,
        balance_usdc: "126.8818059542916",
      },
    });

    expect(step.title).toBe("Get account details");
    expect(labelsFor(step.chips)).toEqual([
      "Arc",
      "0xda65...3cf0",
      "126.88181 USDC",
    ]);
    expect(step.chips[2].icon).toBe(CoinsIcon);
  });

  it("shows the verified ERC-20 balance without rounding it", () => {
    const step = interpretToolStep({
      toolName: "get_erc20_balance",
      result: {
        chain_id: 5042,
        token: "0x3600000000000000000000000000000000000000",
        holder: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance_raw: "126881805",
        balance: "126.881805",
        decimals: 6,
      },
    });

    expect(step.title).toBe("Get balance");
    expect(labelsFor(step.chips)).toEqual([
      "Arc",
      "USDC",
      "0xda65...3cf0",
      "126.881805 USDC",
    ]);
  });

  it("shows an unknown token's address without guessing its symbol or unit", () => {
    const step = interpretToolStep({
      toolName: "get_erc20_balance",
      argsText: JSON.stringify({ token_address: "USDC" }),
      result: {
        chain_id: 8453,
        token: "0x1111111111111111111111111111111111111111",
        holder: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance: "0",
      },
    });

    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0x1111...1111",
      "0xda65...3cf0",
      "0",
    ]);
  });

  it("shows the holdings limit and query", () => {
    const step = interpretToolStep({
      toolName: "get_erc20_holdings",
      argsText: JSON.stringify({ chain_id: null, query: "USDC", limit: 10 }),
      result: {
        scope: "configured_indexed_mainnets",
        complete: true,
        chains: [],
        checked_chains: [8453],
        failed_chains: [],
        unsupported_chains: [],
      },
    });

    expect(step.title).toBe("Get holdings");
    expect(labelsFor(step.chips)).toEqual(["Top 10", "USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
  });

  it("shows a chosen chain first, then the default limit", () => {
    const step = interpretToolStep({
      toolName: "get_erc20_holdings",
      argsText: JSON.stringify({ chain_id: 8453, query: null, limit: null }),
      result: {
        chain_id: 8453,
        holder: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        complete: true,
        items: [],
        total_matching: 0,
        next_cursor: null,
        warnings: [],
      },
    });

    expect(labelsFor(step.chips)).toEqual(["Base", "Top 20"]);
  });

  it("keeps the holdings title on errors without calling an error zero assets", () => {
    const step = interpretToolStep({
      toolName: "get_erc20_holdings",
      result: { is_error: true, error: "holdings_indexer_unsupported" },
    });
    expect(step.title).toBe("Get holdings");
    expect(labelsFor(step.chips)).toEqual(["Failed"]);
  });

  it("standardizes token resolution chips", () => {
    const step = interpretToolStep({
      toolName: "get_contract",
      result: {
        found: true,
        count: 1,
        contracts: [
          {
            address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            chain: "base",
            chain_id: 8453,
            name: "FiatTokenProxy",
            symbol: "USDC",
          },
        ],
      },
    });

    expect(step.title).toBe("Get contract details");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("shows one useful contract identity for ABI lookups", () => {
    const pool = interpretToolStep({
      toolName: "get_contract",
      argsText: JSON.stringify({
        mode: "abi",
        chain_id: 42161,
        address: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
        protocol: "Aave",
        contract_type: "Aave Pool",
      }),
      result: [{ type: "function", name: "getFlashLoanLogic" }],
    });
    expect(labelsFor(pool.chips)).toEqual(["Arbitrum", "Aave Pool"]);

    const token = interpretToolStep({
      toolName: "get_contract",
      argsText: JSON.stringify({
        mode: "abi",
        chain_id: 42161,
        symbol: "aArbUSDCn",
        protocol: "Aave",
        contract_type: "ERC20",
      }),
    });
    expect(labelsFor(token.chips)).toEqual(["Arbitrum", "Aave"]);
  });

  it("omits not-found badges for token misses", () => {
    const step = interpretToolStep({
      toolName: "get_contract",
      result: {
        found: false,
        count: 0,
        contracts: [],
      },
    });

    expect(step.title).toBe("Get contract details");
    expect(labelsFor(step.chips)).toEqual([]);
  });

  it("shows chain for token misses when the payload carries one", () => {
    const step = interpretToolStep({
      toolName: "get_contract",
      result: {
        found: false,
        count: 0,
        chain_id: 8453,
        contracts: [],
      },
    });

    expect(step.title).toBe("Get contract details");
    expect(labelsFor(step.chips)).toEqual(["Base"]);
  });

  it("recognizes ERC-20 balance calls without token-specific formatting", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          input:
            "0x70a08231000000000000000000000000da65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "131961",
          },
        },
      },
    });

    expect(step.title).toBe("Get balance");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC", "0xda65...3cf0"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("uses a generic token icon for decoded approval amounts", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          input: `0x095ea7b3${"0".repeat(24)}cf77a3ba9a5ca399b7c97c74d54e5b1beb874e43${"0".repeat(60)}c350`,
          chain_id: 8453,
        },
      },
    });

    expect(step.title).toBe("Approve token spend");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xcf77...4e43",
      "50000 raw units",
    ]);
    expect(step.chips[2].icon).toBe(CoinsIcon);
  });

  it("distinguishes Aave V4 market preparation from execution", () => {
    const step = interpretToolStep({
      toolName: "aave_v4_prepare",
      result: {
        protocol: "aave_v4",
        chain_id: 5042,
        status: "prepared",
        operation: "supply",
        amount: { display: "5 USDC" },
        approval: { required: true },
        spoke: { name: "forex" },
        reserve: { symbol: "USDC" },
        tx: { value: "0", input: "0x1234" },
      },
    });
    expect(labelsFor(step.chips)).toContain("Arc");
    expect(step.title).toBe("Prepare Aave V4 supply");
    expect(labelsFor(step.chips)).toContain("5 USDC");
    expect(labelsFor(step.chips)).not.toContain("Aave V4");
    expect(labelsFor(step.chips)).toContain("Approval required");
    expect(
      step.chips.find((chip) => chip.label === "Approval required")?.icon,
    ).toBeDefined();
    expect(labelsFor(step.chips)).toContain("Prepared");
    expect(labelsFor(step.chips)).not.toContain("Success");
  });

  it("reads Aave markets without repeating the protocol in a chip", () => {
    const step = interpretToolStep({
      toolName: "aave_v4_markets",
      result: { protocol: "aave_v4", chain_id: 5042, markets: [] },
    });
    expect(step.title).toBe("Read Aave V4 markets");
    expect(labelsFor(step.chips)).toEqual(["Arc"]);
  });

  it("shows the Morpho vault's chain without a text-only name chip", () => {
    const step = interpretToolStep({
      toolName: "morpho_vault_overview",
      result: {
        source: "morpho",
        vault: {
          name: "Arc USDC Prime",
          version: "v2",
          chain_id: 5042,
          asset: { symbol: "USDC" },
        },
      },
    });
    expect(labelsFor(step.chips)).toContain("Arc");
    expect(labelsFor(step.chips)).not.toContain("Arc USDC Prime");
    expect(labelsFor(step.chips)).not.toContain("Morpho");
  });

  it("shows Circle Gateway deposit amounts without implying a completed bridge", () => {
    const step = interpretToolStep({
      toolName: "circle_gateway_prepare_deposit",
      result: {
        protocol: "circle_gateway",
        chain: { chain_id: 5042 },
        token: { symbol: "USDC", decimals: 6 },
        amount: { raw: "10000000", display: "10 USDC" },
      },
    });
    expect(labelsFor(step.chips)).toContain("Arc");
    expect(step.title).toBe("Prepare Circle Gateway deposit");
    expect(labelsFor(step.chips)).toContain("10 USDC");
    expect(labelsFor(step.chips)).not.toContain("Success");
  });

  it("shows the CCTP route and attestation readiness separately from settlement", () => {
    const step = interpretToolStep({
      toolName: "circle_cctp_prepare_transfer",
      result: {
        protocol: "cctp_v2",
        source: { chain_id: 8453 },
        destination: { chain_id: 5042 },
        status: "attestation_ready",
        amount: { display: "10 USDC" },
      },
    });
    expect(labelsFor(step.chips)).toContain("Base → Arc");
    expect(labelsFor(step.chips)).toContain("Attestation ready");
    expect(step.chips.every((chip) => chip.icon)).toBe(true);
    expect(labelsFor(step.chips)).not.toContain("Success");
  });

  it("shows the cached Gateway transfer summary before wallet approval", () => {
    const step = interpretToolStep({
      toolName: "circle_gateway_prepare_transfer",
      result: {
        protocol: "circle_gateway",
        summary: {
          source: { chain_id: 1 },
          destination: { chain_id: 5042 },
          amount: { raw: "10000000", display: "10 USDC" },
        },
      },
    });
    expect(labelsFor(step.chips)).toContain("Ethereum → Arc");
    expect(labelsFor(step.chips)).toContain("10 USDC");
    expect(labelsFor(step.chips)).not.toContain("Success");
  });

  it.each([
    ["aerodrome", "Aerodrome"],
    ["uniswap_v4", "Uniswap V4"],
  ])(
    "identifies %s preparation without implying execution",
    (protocol, label) => {
      const step = interpretToolStep({
        toolName:
          protocol === "aerodrome"
            ? "aerodrome_arc_prepare_swap"
            : "uniswap_v4_swap",
        result: {
          protocol,
          chain_id: 5042,
          status: "prepared",
          token: { symbol: "USDC", decimals: 6 },
          amount: { raw: "1000000", display: "1 USDC" },
        },
      });
      expect(step.title).toContain(label);
      expect(labelsFor(step.chips)).toContain("Arc");
      expect(labelsFor(step.chips)).toContain("1 USDC");
      expect(labelsFor(step.chips)).toContain("Prepared");
      expect(labelsFor(step.chips)).not.toContain("Success");
    },
  );

  it("shows Arc ERC-20 USDC approvals in six-decimal units", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          to: "0x3600000000000000000000000000000000000000",
          input: `0x095ea7b3${"0".repeat(24)}a4072583658fae592a3506a42431cb6316a8d40b${"0".repeat(58)}989680`,
          chain_id: 5042,
        },
      },
    });
    expect(labelsFor(step.chips)).toEqual([
      "Arc",
      "USDC",
      "0xa407...d40b",
      "10 USDC",
    ]);
  });

  it("preserves Arc swap amounts without treating USDC as ETH", () => {
    const step = interpretToolStep({
      toolName: "lifi_get_quote",
      result: {
        quote_id: "lifi_arc",
        chain_id: 5042,
        from_token: { symbol: "USDC", decimals: 6, is_native: false },
        to_token: { symbol: "EURC", decimals: 6 },
        from_amount: { raw: "10000000", display: "10 USDC" },
        estimate: { to_amount_display: "8.68248 EURC" },
      },
    });
    expect(labelsFor(step.chips)).toEqual([
      "Arc",
      "USDC -> EURC",
      "10 USDC",
      "8.68248 EURC",
    ]);
  });

  it("normalizes approval units only for a verified chain and token contract", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          input: `0x095ea7b3${"0".repeat(24)}cf77a3ba9a5ca399b7c97c74d54e5b1beb874e43${"0".repeat(60)}c350`,
          chain_id: 8453,
        },
      },
    });

    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC",
      "0xcf77...4e43",
      "0.05 USDC",
    ]);
    expect(step.chips[3].icon).toBe(CoinsIcon);
  });

  it("uses the exact Get balance title before and after tool errors", () => {
    expect(interpretToolStep({ toolName: "get_erc20_balance" }).title).toBe(
      "Get balance",
    );
    expect(
      interpretToolStep({
        toolName: "get_erc20_balance",
        result: { is_error: true, error: "upstream unavailable" },
      }).title,
    ).toBe("Get balance");
  });

  it("recognizes ERC-20 decimal reads", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          to: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
          input: "0x313ce567",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "6",
          },
        },
      },
    });

    expect(step.title).toBe("Read token decimals");
    expect(labelsFor(step.chips)).toEqual(["Base", "6 decimals"]);
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("recognizes allowance checks without value chips", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          input:
            "0xdd62ed3e000000000000000000000000da65d415cc9d5ddc2a08bdffc996750755fc3cf0000000000000000000000000cf77a3ba9a5ca399b7c97c74d54e5b1beb874e43",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "0",
          },
        },
      },
    });

    expect(step.title).toBe("Check allowance");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC",
      "0xda65...3cf0",
      "0xcf77...4e43",
    ]);
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("falls back to the model label for protocol-specific calls", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
          input:
            "0x79bc57d5000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd986310000000000000000000000000000000000000000000000000000000000000000",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            as_address: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
          },
        },
      },
    });

    expect(step.title).toBe("Call contract");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xda65...3cf0",
      "0x420d...40da",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("shows the called function without its signature arguments", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      argsText: JSON.stringify({
        chain_id: 42161,
        from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        to: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
        function_signature: "withdraw(address,uint256,address)",
      }),
      result: {
        success: true,
        tx: {
          chain_id: 42161,
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
          input: "0x69328dec",
        },
      },
    });

    expect(labelsFor(step.chips)).toEqual([
      "Arbitrum",
      "0xda65...3cf0",
      "0x794a...14ad",
      "Withdraw",
    ]);
    expect(step.chips[3].icon).toBe(BracesIcon);
  });

  it("recognizes staged swaps", () => {
    const step = interpretToolStep({
      toolName: "evm_stage_tx",
      result: {
        chain_id: 8453,
        data: "0xcac88ea9000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd98631",
        kind: "swap",
        pending_tx_id: 2,
        current_lifecycle: "queued",
      },
    });

    expect(step.title).toBe("Stage transaction");
    expect(labelsFor(step.chips)).toEqual(["Base", "1 tx", "Swap", "Staged"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("capitalizes staged ERC-20 approval labels and uses action and tx icons", () => {
    const step = interpretToolStep({
      toolName: "evm_stage_tx",
      result: {
        chain_id: 8453,
        data: "0x095ea7b3000000000000000000000000cf77a3ba9a5ca399b7c97c74d54e5b1beb874e430000000000000000000000000000000000000000000000000000000000002710",
        kind: "erc20_approve",
        pending_tx_id: 1,
        current_lifecycle: "queued",
      },
    });

    expect(step.title).toBe("Stage transaction");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "1 tx",
      "Approve",
      "Staged",
    ]);
    expect(step.chips[2].icon).toBe(PencilLineIcon);
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("keeps a generic icon on unknown staged action chips", () => {
    const step = interpretToolStep({
      toolName: "evm_stage_tx",
      result: {
        chain_id: 8453,
        data: "0x12345678",
        kind: "delegate_vote",
        pending_tx_id: 3,
        current_lifecycle: "queued",
      },
    });

    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "1 tx",
      "Delegate vote",
      "Staged",
    ]);
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("does not infer routes from hardcoded protocol or token addresses", () => {
    const step = interpretToolStep({
      toolName: "encode_and_call",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
          input:
            "0x5509a1ac000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd98631000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          chain_id: 8453,
        },
      },
    });

    expect(step.title).toBe("Call contract");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xda65...3cf0",
      "0xcf77...4e43",
    ]);
  });

  it("recognizes simulations", () => {
    const step = interpretToolStep({
      toolName: "simulate_batch",
      result: {
        resolved_ids: [1, 2],
        simulation: {
          batch_success: true,
          network: "base",
          total_gas: 262888,
          steps: [{ step: 1 }, { step: 2 }],
        },
      },
    });

    expect(step.title).toBe("Simulate transaction");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "2 txs",
      "262,888 gas",
      "Passed",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
    expect(step.chips[3].icon).toBeTypeOf("object");
  });

  it("derives current simulation status from execution evidence", () => {
    const result = interpretToolStep({
      toolName: "simulate_batch",
      result: {
        simulation: {
          contexts: [{ chain_id: 8453 }],
          steps: [
            {
              step: 1,
              chain_id: 8453,
              execution: { status: { kind: "succeeded" }, gas_used: 21000 },
            },
          ],
        },
      },
    });
    expect(labelsFor(result.chips)).toContain("Passed");
    expect(labelsFor(result.chips)).toContain("21,000 gas");
    const skipped = interpretToolStep({
      toolName: "simulate_batch",
      result: {
        simulation: {
          contexts: [{ chain_id: 8453 }],
          steps: [{ step: 1, chain_id: 8453, execution: null }],
        },
      },
    });
    expect(labelsFor(skipped.chips)).not.toContain("Passed");
  });

  it("recognizes successful Solana simulations", () => {
    const step = interpretToolStep({
      toolName: "svm_simulate_ix",
      result: {
        simulation: {
          err: null,
          logs: ["Program 11111111111111111111111111111111 success"],
          units_consumed: 450,
        },
        last_batch_status: "SVM ixs [1] passed",
        ix_ids: [1],
      },
    });

    expect(step.title).toBe("Simulate transaction");
    expect(labelsFor(step.chips)).toEqual([
      "1 tx",
      "450 compute units",
      "Passed",
    ]);
  });

  it("recognizes pending wallet approval", () => {
    const step = interpretToolStep({
      toolName: "evm_commit_txs",
      result: {
        chain_id: 8453,
        status: "pending_approval",
        tx_ids: [1, 2],
      },
    });

    expect(step.title).toBe("Commit transactions");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "2 txs",
      "Awaiting approval",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("shows the Solana transaction count while awaiting wallet approval", () => {
    const step = interpretToolStep({
      toolName: "svm_commit_txs",
      result: {
        status: "pending_approval",
        chain_kind: "svm",
        svm_ix_ids: [1, 2, 3, 4, 5, 6],
        unsigned_tx: "AQAAAAAAAA",
        cluster: "mainnet-beta",
      },
    });

    expect(step.title).toBe("Commit transactions");
    expect(labelsFor(step.chips)).toEqual([
      "Solana",
      "1 tx",
      "Awaiting approval",
    ]);
  });
  it("recognizes a delegated task with the child label and staged count", () => {
    const step = interpretToolStep({
      toolName: "task",
      argsText: JSON.stringify({
        label: "swap-worker",
        app: "default",
        prompt: "swap half my USDC",
      }),
      result: {
        agent_id: "task-agent:9f2c1a2b3c4d",
        status: "completed",
        staged_count: 1,
      },
    });

    expect(step.title).toBe("Delegated: swap-worker");
    expect(labelsFor(step.chips)).toEqual(["staged 1"]);
    expect(step.failed).toBe(false);
  });

  it("falls back to a generic delegation title without args", () => {
    const step = interpretToolStep({
      toolName: "task",
      result: {
        agent_id: "task-agent:9f2c1a2b3c4d",
        status: "completed",
        staged_count: 0,
      },
    });

    expect(step.title).toBe("Delegated task");
    expect(labelsFor(step.chips)).toEqual([]);
  });

  it("marks a non-completed delegation as failed", () => {
    const step = interpretToolStep({
      toolName: "task",
      argsText: JSON.stringify({ label: "approvals-auditor" }),
      result: {
        agent_id: "task-agent:0011223344",
        status: "stalled",
        staged_count: 0,
      },
    });

    expect(step.title).toBe("Delegated: approvals-auditor");
    expect(labelsFor(step.chips)).toEqual([]);
    expect(step.failed).toBe(true);
  });
});
