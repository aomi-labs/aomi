export const MARKETING_ROOT = "";

export type Tone = "blue" | "pink" | "green" | "ink";

export type NavItem = {
  title: string;
  href: string;
  description: string;
  external?: boolean;
};

export type DetailPage = NavItem & {
  slug: string;
  eyebrow: string;
  headline: string;
  summary: string;
  tone: Tone;
  audience: string;
  proof: string;
  capabilities: readonly {
    title: string;
    body: string;
  }[];
  flow: readonly {
    title: string;
    body: string;
  }[];
};

export const products = [
  {
    slug: "widget",
    title: "Human Interface",
    href: `${MARKETING_ROOT}/products/widget`,
    description: "Embed chat-to-transaction in your product.",
    eyebrow: "Product / Human Interface",
    headline: "Put guarded execution inside the product users already trust.",
    summary:
      "Mount Aomi as a full surface, sidecar, or inline assistant. Your application keeps its identity, customer relationship, and wallet presentation while Aomi runs the agent loop and returns exact payloads to the signer.",
    tone: "blue",
    audience:
      "Wallets, exchanges, vaults, fintech applications, and protocol frontends.",
    proof:
      "Sommelier ships the Aomi execution surface above its existing liquidity interface, preserving the host dashboard and the user's wallet boundary.",
    capabilities: [
      {
        title: "Host-owned experience",
        body: "Bring application identity, authentication, theme, wallet presentation, and the product controls your customers already know.",
      },
      {
        title: "One execution surface",
        body: "Render plans, interpreted tools, simulation evidence, approvals, and final receipts through the same composable frame.",
      },
      {
        title: "Signer stays outside",
        body: "Aomi receives display-safe wallet context and signing results. Provider credentials and private keys remain with the integrator.",
      },
      {
        title: "Three placement modes",
        body: "Use a full-page assistant, a floating sidecar over product UI, or a focused inline workflow without forking the execution contract.",
      },
    ],
    flow: [
      {
        title: "Authenticate",
        body: "Resolve the signed-in account, wallet, chain, and application before an execution thread begins.",
      },
      {
        title: "Interpret",
        body: "Turn customer language and product-native controls into a bounded execution plan.",
      },
      {
        title: "Authorize",
        body: "Return the simulated payload to the integrator's signer for explicit or policy-scoped approval.",
      },
      {
        title: "Reconcile",
        body: "Display transaction status, receipts, and final state inside the host product.",
      },
    ],
  },
  {
    slug: "agentic-toolings",
    title: "Agent Toolings",
    href: `${MARKETING_ROOT}/products/agentic-toolings`,
    description: "Skills, hosted MCP, and CLI for the agents you use.",
    eyebrow: "Product / Agent Toolings",
    headline:
      "Give existing agents a disciplined path from intent to settlement.",
    summary:
      "Agent Skills teach the workflow, hosted MCP provides account-scoped sessions, and the CLI gives operators a direct terminal surface. They are separate entry points over the same guarded execution harness.",
    tone: "green",
    audience:
      "Coding agents, agent frameworks, researchers, and technical operators.",
    proof:
      "The same task can start in Codex, continue through an authenticated MCP session, and finish with an operator approving the exact transaction in the CLI.",
    capabilities: [
      {
        title: "Agent Skills",
        body: "Install durable workflow instructions that teach planning, preflight, wallet context, approval, and receipt verification.",
      },
      {
        title: "Hosted MCP",
        body: "Connect an authenticated Aomi account and expose chat, status, interruption, and session tools to an outer agent.",
      },
      {
        title: "Client CLI",
        body: "Inspect wallets, run sessions, list staged transactions, sign requests, and reconcile receipts without a browser shell.",
      },
      {
        title: "Explicit boundaries",
        body: "Installation, session identity, chain context, signing, and broadcast stay visible instead of collapsing into one opaque command.",
      },
    ],
    flow: [
      {
        title: "Install",
        body: "Choose the Skill, MCP connection, or CLI package that fits the outer agent and operator environment.",
      },
      {
        title: "Start a session",
        body: "Bind the task to an authenticated Aomi account and supply chain context only when it is authoritative.",
      },
      {
        title: "Review the request",
        body: "Inspect what the harness constructed, its simulation result, and the exact approval boundary.",
      },
      {
        title: "Verify settlement",
        body: "Do not stop at a queued command: reconcile the final receipt, events, and resulting state.",
      },
    ],
  },
  {
    slug: "rest-apis",
    title: "REST APIs",
    href: `${MARKETING_ROOT}/products/rest-apis`,
    description: "Agent orchestration or direct transaction-pipeline control.",
    eyebrow: "Product / REST APIs",
    headline:
      "Choose how much judgment belongs to Aomi and how much stays in your system.",
    summary:
      "Agents API lets an outer application submit intent while Aomi orchestrates specialist agents. Pipeline API exposes the guarded stage, simulate, authorize, commit, and reconcile lifecycle directly, with no Aomi inference in the control loop.",
    tone: "pink",
    audience:
      "Platforms building custom agent loops, orchestration systems, and transaction products.",
    proof:
      "Both APIs converge on the same Action contract, execution policy, signer boundary, idempotency model, and evidence trail.",
    capabilities: [
      {
        title: "Agents API",
        body: "Submit natural-language intent, application context, and constraints while Aomi manages the model-to-tool loop.",
      },
      {
        title: "Pipeline API",
        body: "Call the underlying transaction tools directly when your own orchestrator owns inference and branching.",
      },
      {
        title: "Shared Action contract",
        body: "Plans, simulations, approvals, commits, retries, and receipts use one durable lifecycle across both surfaces.",
      },
      {
        title: "Deterministic recovery",
        body: "Idempotency and persisted execution state let clients resume without silently rebuilding or double-submitting a transaction.",
      },
    ],
    flow: [
      {
        title: "Plan",
        body: "Resolve intent, tools, policy, target chain, wallet identity, and dependencies into an explicit Action.",
      },
      {
        title: "Simulate",
        body: "Rehearse the proposed transaction against current chain state and return interpretable evidence.",
      },
      {
        title: "Authorize",
        body: "Request the appropriate signer or delegated policy without moving custody into the runtime.",
      },
      {
        title: "Commit and reconcile",
        body: "Broadcast once, follow durable state, and return receipts or actionable failure details.",
      },
    ],
  },
  {
    slug: "plugin-sdk",
    title: "Plugin SDK",
    href: `${MARKETING_ROOT}/products/plugin-sdk`,
    description: "Build and host applications on Aomi's shared runtime.",
    eyebrow: "Product / Plugin SDK",
    headline:
      "Turn an API and operating mandate into a hosted transactional application.",
    summary:
      "Package prompts, typed tools, policy, and protocol knowledge as an Aomi App. Deploy through the developer console and let Aomi operate the model-to-tool loop over the same transaction pipeline used by every surface.",
    tone: "ink",
    audience:
      "Protocol teams, fintech developers, exchanges, and application partners.",
    proof:
      "Aomi Apps behave like hosted connectors with transaction capability: versioned, deployable, observable, and bound to the partner platform that owns them.",
    capabilities: [
      {
        title: "Typed tools",
        body: "Expose API operations through explicit schemas, validation, errors, and descriptions the runtime can reason about.",
      },
      {
        title: "Mandate as code",
        body: "Keep venue allowlists, value caps, risk limits, and required approvals outside model prose.",
      },
      {
        title: "Managed deployment",
        body: "Bind source, immutable commit, environment configuration, and active runtime release through one project lifecycle.",
      },
      {
        title: "Built-in observability",
        body: "Inspect application sessions, tool calls, execution traces, releases, and receipts without building a second control plane.",
      },
    ],
    flow: [
      {
        title: "Describe",
        body: "Start from an API specification, SDK, repository example, or endpoint notes and identify the transactional jobs.",
      },
      {
        title: "Build",
        body: "Implement typed tools, prompts, policy, tests, and local deterministic fixtures in the SDK.",
      },
      {
        title: "Deploy",
        body: "Create a project, bind the platform, resolve an immutable source commit, and activate the release.",
      },
      {
        title: "Operate",
        body: "Observe live sessions and evolve the application without changing the user's signer or product surface.",
      },
    ],
  },
] as const satisfies readonly DetailPage[];

export const solutions = [
  {
    slug: "fintech",
    title: "Fintech",
    href: `${MARKETING_ROOT}/solutions/fintech`,
    description:
      "White-label automation for vaults, RWA, and tokenized products.",
    eyebrow: "Solution / Fintech",
    headline:
      "Add agentic automation without replacing custody, policy, or customer trust.",
    summary:
      "Bring portfolio rules, product APIs, and the wallet stack you already operate. Aomi converts customer or operator intent into governed, simulated transactions and returns them to your authorization boundary.",
    tone: "blue",
    audience:
      "Neobanks, tokenization platforms, RWA products, treasuries, and embedded-finance teams.",
    proof:
      "The integration keeps identity, balances, policy, signing, execution, and receipts as separate authorities instead of hiding them behind a conversational UI.",
    capabilities: [
      {
        title: "White-label surfaces",
        body: "Ship conversational investing and automation inside the existing product shell.",
      },
      {
        title: "Product policy",
        body: "Enforce supported assets, venues, value limits, eligibility, and approval requirements outside the model.",
      },
      {
        title: "Wallet compatibility",
        body: "Work with browser, embedded, institutional, or account-abstracted signing paths.",
      },
      {
        title: "Operational evidence",
        body: "Keep intent, policy decision, simulation, authorization, receipt, and final state together.",
      },
    ],
    flow: [
      {
        title: "Connect product context",
        body: "Resolve the customer, account, portfolio, entitlements, and active wallet.",
      },
      {
        title: "Propose",
        body: "Translate a goal into an explainable plan within the product's constraints.",
      },
      {
        title: "Authorize",
        body: "Use the product's existing signing, approval, and compliance controls.",
      },
      {
        title: "Report",
        body: "Return execution evidence to the customer experience and operations systems.",
      },
    ],
  },
  {
    slug: "defi",
    title: "DeFi",
    href: `${MARKETING_ROOT}/solutions/defi`,
    description: "Chat-to-trade for protocols, venues, and frontends.",
    eyebrow: "Solution / DeFi",
    headline:
      "Make protocol depth accessible without flattening its constraints.",
    summary:
      "Wrap protocol APIs and contracts as typed capabilities, encode the venue's invariants, and let users act through language while every transaction still passes deterministic construction and simulation.",
    tone: "green",
    audience:
      "DEXs, lending markets, staking products, vault protocols, bridges, and aggregators.",
    proof:
      "Protocol-specific knowledge loads when the task needs it, but policy, calldata construction, simulation, and signing remain explicit execution stages.",
    capabilities: [
      {
        title: "Protocol-aware tools",
        body: "Capture asset semantics, routes, positions, approvals, and venue-specific guardrails.",
      },
      {
        title: "Multi-step execution",
        body: "Compose approvals, swaps, bridges, deposits, and position changes into reviewable workflows.",
      },
      {
        title: "Fresh-state simulation",
        body: "Check the exact proposal against current balances, allowances, liquidity, and protocol state.",
      },
      {
        title: "Composable delivery",
        body: "Expose the experience through Human Interface, Agents API, Pipeline API, MCP, or CLI.",
      },
    ],
    flow: [
      {
        title: "Resolve the position",
        body: "Read wallet state, protocol positions, balances, allowances, and venue conditions.",
      },
      {
        title: "Construct the route",
        body: "Select tools and transaction ordering within protocol and policy constraints.",
      },
      {
        title: "Rehearse",
        body: "Simulate the complete sequence before asking for a signature.",
      },
      {
        title: "Settle",
        body: "Broadcast, follow every step, and reconcile the resulting protocol position.",
      },
    ],
  },
  {
    slug: "trading",
    title: "Trading",
    href: `${MARKETING_ROOT}/solutions/trading`,
    description: "Hosted or bring-your-own agents for the trader's desk.",
    eyebrow: "Solution / Trading",
    headline:
      "Move from analysis to policy-bounded execution across venues and chains.",
    summary:
      "Give a trader or strategy agent a consistent layer for market reads, order construction, venue routing, risk checks, approval, and settlement while the trader keeps the account and keys.",
    tone: "pink",
    audience:
      "Trading platforms, exchanges, prediction markets, funds, and sophisticated individual desks.",
    proof:
      "A hosted Aomi App can wrap proprietary APIs, while Agents API and Pipeline API let an external orchestrator keep judgment and use Aomi only for guarded execution.",
    capabilities: [
      {
        title: "Venue abstraction",
        body: "Normalize reads and writes without erasing the order semantics of each destination.",
      },
      {
        title: "Programmable orders",
        body: "Support conditional, scheduled, batched, cross-chain, and portfolio-level workflows.",
      },
      {
        title: "Risk before signature",
        body: "Apply exposure, slippage, venue, asset, and notional controls before payload approval.",
      },
      {
        title: "Receipt-grade results",
        body: "Distinguish a queued request from broadcast, confirmation, events, and final balance state.",
      },
    ],
    flow: [
      {
        title: "Read",
        body: "Collect positions, balances, quotes, liquidity, and strategy context.",
      },
      {
        title: "Decide",
        body: "Let the owning agent select a trade or rebalance within an explicit mandate.",
      },
      {
        title: "Execute",
        body: "Construct, simulate, authorize, and submit the exact order or transaction.",
      },
      {
        title: "Reconcile",
        body: "Confirm fills, receipts, position changes, and any remaining workflow state.",
      },
    ],
  },
  {
    slug: "nft",
    title: "NFT",
    href: `${MARKETING_ROOT}/solutions/nft`,
    description: "Hosted transactional agents for marketplaces and collectors.",
    eyebrow: "Solution / NFT",
    headline:
      "Give marketplaces task-specific agents without giving them user custody.",
    summary:
      "Let users discover, price, list, bid, purchase, or manage collections through purpose-built agents that operate inside marketplace policy and return exact actions to the user's wallet.",
    tone: "ink",
    audience:
      "NFT marketplaces, creator platforms, gaming economies, and collection-management products.",
    proof:
      "One-shot light agents can be scoped to a single collection or campaign, while durable hosted bots can serve the broader branded marketplace.",
    capabilities: [
      {
        title: "Marketplace tools",
        body: "Wrap discovery, listing, offers, royalties, metadata, and settlement APIs as typed operations.",
      },
      {
        title: "Campaign agents",
        body: "Launch short-lived agents for drops, collections, quests, or creator activations.",
      },
      {
        title: "Policy controls",
        body: "Restrict contracts, collections, venues, price bands, spending, and approval modes.",
      },
      {
        title: "Wallet-native approval",
        body: "Keep purchase, listing, and transfer authority with the user's current signer.",
      },
    ],
    flow: [
      {
        title: "Discover",
        body: "Resolve the collection, asset, ownership, venue, price, and applicable marketplace policy.",
      },
      {
        title: "Prepare",
        body: "Construct the listing, offer, purchase, approval, or transfer operation.",
      },
      {
        title: "Authorize",
        body: "Show the exact assets, consideration, approvals, and destination to the signer.",
      },
      {
        title: "Confirm",
        body: "Reconcile ownership, listing state, settlement events, and marketplace records.",
      },
    ],
  },
  {
    slug: "wallets",
    title: "Wallets",
    href: `${MARKETING_ROOT}/solutions/wallets`,
    description:
      "Conversational execution above the signer you already operate.",
    eyebrow: "Solution / Wallets",
    headline:
      "Turn the wallet from an approval surface into an execution product.",
    summary:
      "Aomi adds intent understanding, transaction construction, protocol tools, simulation, and automation above the wallet. The wallet remains the identity, authorization, and custody boundary.",
    tone: "blue",
    audience:
      "Self-custody wallets, embedded-wallet providers, smart accounts, and retail investing products.",
    proof:
      "Browser wallets, Para, Privy, and backend-owned account abstraction can share the same high-level workflow without sharing credentials or signing implementations.",
    capabilities: [
      {
        title: "Wallet-agnostic contract",
        body: "Resolve owner and chain, then request signatures through the provider-specific boundary.",
      },
      {
        title: "Gas and batching",
        body: "Support sponsored fees, batching, and account abstraction without leaking infrastructure credentials.",
      },
      {
        title: "Read-only first",
        body: "Allow analysis and planning while disconnected, then bind authoritative wallet context before execution.",
      },
      {
        title: "Revocable automation",
        body: "Operate scheduled workflows only within monitored and removable delegated authority.",
      },
    ],
    flow: [
      {
        title: "Connect",
        body: "Authenticate the owner and resolve the active wallet family and network.",
      },
      {
        title: "Plan",
        body: "Interpret the request and construct a wallet-specific, policy-compliant proposal.",
      },
      {
        title: "Sign",
        body: "Hand only the exact authorization request to the wallet or delegated signer.",
      },
      {
        title: "Return",
        body: "Bring receipts and resulting balances back into the wallet's own experience.",
      },
    ],
  },
] as const satisfies readonly DetailPage[];

export const resources = [
  {
    title: "About",
    href: `${MARKETING_ROOT}/about`,
    description: "Why Aomi exists and how the company thinks about execution.",
  },
  {
    title: "Research",
    href: `${MARKETING_ROOT}/research`,
    description:
      "Authentication, agent evaluation, and onchain execution systems.",
  },
  {
    title: "News",
    href: `${MARKETING_ROOT}/news`,
    description: "Product notes, company updates, and announcements.",
  },
  {
    title: "Contact",
    href: `${MARKETING_ROOT}/contact`,
    description: "Talk with the team about a product or integration.",
  },
] as const satisfies readonly NavItem[];

export const developers = [
  {
    title: "Documentation",
    href: "/docs",
    description: "Guides and references for Aomi products.",
  },
  {
    title: "Agents",
    href: "/agents.md",
    description: "Machine-readable instructions for coding agents.",
  },
  {
    title: "GitHub",
    href: "https://github.com/aomi-labs",
    description: "SDKs, Skills, examples, and open source tooling.",
    external: true,
  },
] as const satisfies readonly NavItem[];

export const pricingLinks = [
  {
    title: "Pricing",
    href: `${MARKETING_ROOT}/pricing`,
    description: "What a turn costs, and when an app takes a cut.",
  },
  {
    title: "Payment rails",
    href: `${MARKETING_ROOT}/pricing/payment-rails`,
    description:
      "The credit balance, the deferred pay gate, and how turns settle.",
  },
] as const;

export const navGroups = [
  { label: "Products", items: products },
  { label: "Solutions", items: solutions },
  { label: "Resources", items: resources },
  { label: "Developers", items: developers },
  { label: "Pricing", items: pricingLinks },
] as const;

export const productBySlug = Object.fromEntries(
  products.map((item) => [item.slug, item]),
) as Record<string, DetailPage>;

export const solutionBySlug = Object.fromEntries(
  solutions.map((item) => [item.slug, item]),
) as Record<string, DetailPage>;

export const productLogos = [
  { name: "Across", src: "/assets/logos/across.svg" },
  { name: "Binance", src: "/assets/logos/binance.svg" },
  { name: "CoW Protocol", src: "/assets/logos/cow.svg" },
  { name: "Dune", src: "/assets/logos/dune.png" },
  { name: "Hyperliquid", src: "/assets/logos/hyperliquid.png" },
  { name: "Kalshi", src: "/assets/logos/kalshi.png" },
  { name: "Morpho", src: "/assets/logos/morpho-mark.svg" },
  { name: "Polymarket", src: "/assets/logos/polymarket.png" },
  { name: "Solana", src: "/assets/logos/solana.png" },
  { name: "0x", src: "/assets/logos/zerox.svg" },
] as const;
