import type { BuildTemplate } from "@/features/build/contracts";

/** First-viewport starters on empty Create (order matters). */
export const FEATURED_TEMPLATE_IDS = [
  "tpl_arbitrage_bot",
  "tpl_openapi_agent",
  "tpl_trading_agent",
] as const;

export const BUILD_TEMPLATES: BuildTemplate[] = [
  {
    id: "tpl_arbitrage_bot",
    name: "Arbitrage Bot",
    description: "Multi-venue arbitrage with execution and risk guardrails.",
    category: "trading",
    prompt:
      "I wanna build a hyperliquid & binance arb bot with risk limits and paper-trade first.",
  },
  {
    id: "tpl_trading_agent",
    name: "Trading Agent",
    description:
      "Cross-exchange strategy runner with risk controls and wallet ops.",
    category: "trading",
    prompt:
      "Build a trading agent that can quote, simulate, and stage swaps across venues.",
  },
  {
    id: "tpl_telegram_bot",
    name: "Telegram Bot",
    description: "Auto-responding command bot with deployment and alert hooks.",
    category: "social",
    prompt:
      "Build a Telegram bot that answers portfolio questions and alerts on fills. Give /start a concise greeting that identifies the active app and tells users to use /app to switch between the bot's attached apps.",
  },
  {
    id: "tpl_openapi_agent",
    name: "OpenAPI Agent",
    description: "Wrap REST APIs as agent-callable tools from OpenAPI specs.",
    category: "infra",
    prompt:
      "Scaffold an Aomi app from OpenAPI specs for Hyperliquid and Binance.",
  },
  {
    id: "tpl_mcp_server",
    name: "MCP Server",
    description: "Tool interface with secure command rules and middleware.",
    category: "infra",
    prompt:
      "Create an MCP server that exposes read-only market and account tools.",
  },
  {
    id: "tpl_wallet_agent",
    name: "Wallet Agent",
    description: "Non-custodial wallet ops with simulation and batch signing.",
    category: "trading",
    prompt:
      "Build a wallet agent for simulation-first signing and batch operations.",
  },
  {
    id: "tpl_rag_agent",
    name: "RAG Agent",
    description: "Retrieval pipeline for docs, embeddings, and grounded chat.",
    category: "research",
    prompt: "Build a RAG agent over our protocol docs with citations.",
  },
  {
    id: "tpl_discord_bot",
    name: "Discord Bot",
    description: "Moderation and command bot with webhook integrations.",
    category: "social",
    prompt: "Build a Discord bot for alerts and slash commands into our agent.",
  },
];
