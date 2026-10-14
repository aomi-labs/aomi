import type { ReactNode } from "react";
import {Link} from "@tanstack/react-router";
import { AomiLogo } from "../../../components/aomi-logo";
import type { ResearchPost } from "@/lib/research";
import styles from "./execution-harnesses-research.module.css";

type Props = {
  post: ResearchPost & { body: string };
};

const paymentStages = [
  [
    "Intent",
    "A user, company, or agent defines a goal and the constraints around it.",
  ],
  [
    "Planning",
    "An agent discovers services, compares options, and proposes an action.",
  ],
  [
    "Construction",
    "Software converts that proposal into a concrete order, transaction, or payment request.",
  ],
  [
    "Authorization",
    "Deterministic rules bind the action to user consent, credentials, limits, and compliance checks.",
  ],
  [
    "Funding",
    "A wallet, account, card token, or stablecoin balance supplies value.",
  ],
  [
    "Settlement",
    "A blockchain, card network, bank rail, or hybrid processor finalizes movement.",
  ],
  [
    "Reconciliation",
    "The system confirms delivery, receipts, balance changes, refunds, and exceptions.",
  ],
] as const;

/** Vendor marks are each company's own favicon, normalised to 48px and served
 *  from /public. A name whose mark is a wordmark or is otherwise unreadable at
 *  chip size (GOAT, BVNK), a protocol rather than a company (AP2, MPP, ACP,
 *  UCP), or a category rather than a firm ("banks", "exchanges") stays bare. */
const marksDir = "/research/execution-harnesses-agentic-payments/marks";

type Player = readonly [name: string, mark?: string];

const layers = [
  [
    "01",
    "Agent surfaces and vertical applications",
    "Own the user or business workflow; capture goals, context, preferences, and consent",
    [
      ["ChatGPT", "chatgpt"],
      ["Gemini", "gemini"],
      ["Amazon Rufus", "amazon"],
      ["PayPal", "paypal"],
      ["Bankr", "bankr"],
      ["Virtuals", "virtuals"],
      ["partner-built agent apps"],
    ],
  ],
  [
    "02",
    "Agent runtime and orchestration",
    "Run the model loop, memory, tools, scheduling, retries, state, background work, and multi-step coordination",
    [
      ["Aomi Labs", "aomi"],
      ["Bankr", "bankr"],
      ["Coinbase AgentKit", "coinbase"],
      ["GOAT"],
      ["ElizaOS", "elizaos"],
      ["Virtuals GAME", "virtuals"],
      ["LangChain", "langchain"],
      ["CrewAI", "crewai"],
    ],
  ],
  [
    "03",
    "Domain execution and transaction construction",
    "Translate a plan into an exact API call, order, contract invocation, or transaction batch; simulate and reconcile the result",
    [
      ["Aomi Labs", "aomi"],
      ["1inch", "oneinch"],
      ["deBridge", "debridge"],
      ["Uniswap", "uniswap"],
      ["Kraken", "kraken"],
      ["Crossmint", "crossmint"],
      ["exchanges"],
    ],
  ],
  [
    "04",
    "Identity, mandates, wallets, and signing",
    "Prove who the agent represents, define what it may do, protect credentials, and decide whether to sign",
    [
      ["AP2"],
      ["Visa", "visa"],
      ["Mastercard", "mastercard"],
      ["Coinbase", "coinbase"],
      ["MetaMask", "metamask"],
      ["OKX", "okx"],
      ["Circle", "circle"],
      ["Privy", "privy"],
      ["Turnkey", "turnkey"],
      ["Safe", "safe"],
      ["Fireblocks", "fireblocks"],
    ],
  ],
  [
    "05",
    "Payment coordination and acceptance protocols",
    "Describe price, accepted methods, required proof, and how the service is delivered",
    [["x402", "x402"], ["MPP"], ["ACP"], ["UCP"]],
  ],
  [
    "06",
    "Money, funding, and treasury infrastructure",
    "Supply stable value, bridge fiat and crypto, manage balances and liquidity, and reconcile books",
    [
      ["Circle", "circle"],
      ["Tether", "tether"],
      ["PayPal", "paypal"],
      ["Stripe", "stripe"],
      ["Bridge", "bridge"],
      ["Coinbase", "coinbase"],
      ["Crossmint", "crossmint"],
      ["MoonPay", "moonpay"],
      ["BVNK"],
      ["Zero Hash", "zerohash"],
      ["banks"],
    ],
  ],
  [
    "07",
    "Settlement rails",
    "Final, deterministic movement and record of value",
    [
      ["Base", "base"],
      ["Solana", "solana"],
      ["Ethereum L2s", "ethereum"],
      ["Polygon", "polygon"],
      ["Tempo", "tempo"],
      ["Arc", "arc"],
      ["Visa", "visa"],
      ["Mastercard", "mastercard"],
      ["bank rails"],
    ],
  ],
] as const satisfies readonly (readonly [
  string,
  string,
  string,
  readonly Player[],
])[];

const useCases = [
  [
    "Pay-per-call APIs, data, inference, and compute",
    "Discover, price, pay, and continue without accounts or subscriptions",
    "x402, MPP, stablecoins",
    "Early production; strongest product-market fit",
  ],
  [
    "Browser, storage, and infrastructure sessions",
    "Usage is ephemeral and metered; payment attaches to each session",
    "MPP, x402, cards or stablecoins",
    "Early production",
  ],
  [
    "Agent-to-agent services",
    "Specialized agents subcontract research, data, execution, or verification",
    "x402, MPP, marketplaces",
    "Emerging; discovery, reputation, and delivery proof remain weak",
  ],
  [
    "Consumer shopping, travel, and subscriptions",
    "Search, compare, negotiate, and check out under a mandate",
    "ACP, UCP, AP2 plus cards, wallets, or stablecoins",
    "Expanding launches; merchant operations matter more than rail novelty",
  ],
  [
    "DeFi trading and portfolio management",
    "Continuous monitoring and machine-speed execution",
    "Agent wallets, smart accounts, EVM and Solana",
    "Live but high risk; mostly crypto-native users",
  ],
  [
    "Cross-chain swaps and liquidity routing",
    "Compare routes, fees, timing, and destination requirements",
    "Bridges, DEX aggregators, smart accounts",
    "Live with specialized tools; bridge-state complexity remains",
  ],
  [
    "Corporate procurement and expense",
    "Source vendors, create orders, enforce budgets, and reconcile receipts",
    "Agent cards, AP2, ERP-connected processors, stablecoins",
    "Emerging enterprise category",
  ],
  [
    "Treasury, FX, and cross-border",
    "Optimize timing, liquidity, rail, compliance, and exceptions",
    "Stablecoins, bank rails, cards, and local networks",
    "Pilots; high regulatory and liability burden",
  ],
  [
    "Content and digital-goods micropayments",
    "Remove subscriptions and login friction for one-off access",
    "x402, MPP",
    "Technically live; demand and pricing still being discovered",
  ],
  [
    "Agent revenue, payouts, and self-funding",
    "Charge for services and fund compute",
    "Stablecoin wallets, x402 endpoints, marketplaces",
    "Emerging; service revenue is stronger than speculative token launches",
  ],
  [
    "Compliance and investigation workflows",
    "Enrich alerts, trace funds, and run deterministic playbooks",
    "Enterprise systems with blockchain data",
    "Early production or beta; humans remain accountable",
  ],
] as const;

const serviceSectors = [
  [
    "Agent wallets as programmable authority",
    "Programmable accounts that isolate credentials, enforce scoped mandates, support human escalation, and preserve an audit trail.",
    "Coinbase, MetaMask, OKX, Circle, Crossmint, Privy, Turnkey, MoonPay, Cobo, Fireblocks, Safe",
  ],
  [
    "Payment facilitators and protocol gateways",
    "Infrastructure that verifies payment proofs, submits settlement, and hides rail-specific complexity from sellers and developers.",
    "x402 facilitators, Stripe, Coinbase, Circle, Crossmint",
  ],
  [
    "Agent-native discovery and marketplaces",
    "Machine-readable directories for finding services, comparing prices and schemas, and evaluating delivery histories.",
    "Circle Agent Marketplace, Bankr x402 Cloud, x402scan, Pay.sh, Agentic.Market, Virtuals",
  ],
  [
    "Execution assurance and semantic simulation",
    "Protocol-aware construction, simulation, outcome assertions, and evidence that test what an action will do before it is signed.",
    "Aomi Labs, Tenderly, Blockaid, wallet security providers, specialized risk engines",
  ],
  [
    "Know Your Agent, mandates, and reputation",
    "Identity and authorization systems that establish which agent is acting, for whom, within what limits, and with whose liability.",
    "AP2, Visa Trusted Agent Protocol, Mastercard Agent Pay, OAuth/OIDC, verifiable credentials, onchain registries",
  ],
  [
    "Cross-rail payment orchestration",
    "Routing that selects stablecoin, card, bank, or local rails by cost, availability, reversibility, and compliance.",
    "Stripe, Crossmint, PayPal, Visa, Mastercard, Circle, BVNK, Coinbase",
  ],
  [
    "Agent treasury, accounting, tax, and reconciliation",
    "Back-office systems that attribute balances, gas, receipts, refunds, and tax events to the correct agent, mandate, task, and user.",
    "An underbuilt operating layer for fleets of autonomous accounts",
  ],
  [
    "Disputes, insurance, and service-level guarantees",
    "Proof of delivery, signed receipts, escrow, refunds, and liability mechanisms for failures that settlement finality cannot resolve.",
    "An emerging assurance layer spanning models, runtimes, wallets, facilitators, merchants, issuers, and rails",
  ],
] as const;

// Figure 4 geometry. Maturity (y) is read straight off Table 2; complexity (x) is
// an assessment, so both axes are drawn as named zones rather than numeric scales —
// the chart should not claim precision it does not have. Label sides are hand-placed
// to keep the eleven labels from colliding; if a point moves, re-check its neighbours.
const maturityBands = [
  ["Early production", 70, 165],
  ["Live or expanding", 165, 265],
  ["Emerging", 265, 360],
  ["Pilot", 360, 440],
] as const;

const complexityZones = [
  ["Digital, metered, reversible", 165, 440],
  ["Semantic and counterparty risk", 440, 690],
  ["Physical, regulated, cross-border", 690, 930],
] as const;

const railSpans = [
  ["Crypto-native rails sufficient", 165, 690, "sky"],
  ["Traditional rails also required", 690, 930, "ochre"],
] as const;

/** Section 8.1. Two halves of one market either side of a single axis: left is
 *  intent and planning, right is authority and settlement, and the vertical runs
 *  from broad agent scope down to financial and onchain specifics. Cells alternate
 *  left, right, left, right — an empty title holds a column's place on a row where
 *  only the other side has an entry, so the rows stay paired. The third field is
 *  Aomi Labs' relationship to that layer, which is the point of the section; the two
 *  context layers it makes no claim on carry none. */
const aomiMapAbove = [
  ["Agent surfaces", "ChatGPT · Gemini · Bankr", ""],
  ["Commerce protocols", "ACP · UCP · AP2", ""],
  ["Runtime and orchestration", "MCP · A2A · frameworks", "Primary · layer 2"],
  ["", "", ""],
] as const;

const aomiMapBelow = [
  [
    "Domain execution",
    "AgentKit · 1inch · deBridge",
    "Primary · layer 3",
  ],
  [
    "Wallets and mandates",
    "Coinbase · MetaMask · Privy",
    "Integrated, not owned · layer 4",
  ],
  ["", "", ""],
  ["Payment coordination", "x402 · MPP", "Supported capability · layer 5"],
  ["", "", ""],
  [
    "Money and rails",
    "Stablecoins · cards · chains",
    "Underlying infrastructure · layers 6–7",
  ],
] as const;

/** Bubble area is a third assessed dimension, on the same footing as the x-axis:
 *  how much spend the category could eventually address, drawn as four named steps
 *  because the report carries no market sizing and a continuous scale would claim
 *  arithmetic that does not exist. Colour restates the maturity band so a mark can
 *  be read without tracing it back to the axis. Label sides are hand-placed to keep
 *  the eleven labels from colliding; if a point moves or changes step, re-check its
 *  neighbours — the largest bubbles are 36px across in a 370px-tall plot. */
const maturityPoints = [
  ["Pay-per-call APIs", 210, 100, "start", "early", 3],
  ["Browser & infra sessions", 300, 145, "start", "early", 2],
  ["Compliance workflows", 700, 145, "start", "early", 2],
  ["DeFi trading", 555, 195, "start", "expanding", 3],
  ["Digital-goods micropayments", 250, 215, "start", "expanding", 1],
  ["Consumer shopping", 745, 230, "start", "expanding", 4],
  ["Cross-chain routing", 610, 240, "end", "expanding", 2],
  ["Agent-to-agent services", 480, 300, "end", "emerging", 1],
  ["Procurement & expense", 800, 320, "end", "emerging", 4],
  ["Agent revenue & payouts", 450, 340, "end", "emerging", 1],
  ["Treasury & FX", 885, 405, "end", "pilot", 4],
] as const satisfies readonly (readonly [
  label: string,
  x: number,
  y: number,
  anchor: "start" | "end",
  band: "early" | "expanding" | "emerging" | "pilot",
  size: 1 | 2 | 3 | 4,
])[];

/** Area, not radius, carries the step — a radius scale exaggerates the top end. */
const bubbleRadius = (step: number) => 9 * Math.sqrt(step);

const bandTone = {
  early: styles.mptEarly,
  expanding: styles.mptExpanding,
  emerging: styles.mptEmerging,
  pilot: styles.mptPilot,
};

const protocolFamilies = [
  [
    "Machine payments",
    "Pay for an HTTP resource, API, MCP tool, session, or service",
    "x402, MPP",
    "Native stablecoin settlement; MPP also bridges to fiat methods",
  ],
  [
    "Commerce workflow",
    "Discovery, cart, order, checkout, fulfillment, post-purchase",
    "ACP, UCP",
    "Crypto can be one payment method underneath",
  ],
  [
    "Mandates and trust",
    "Prove user intent, agent identity, scope, and authorization",
    "AP2, Visa Trusted Agent Protocol, Mastercard Agent Pay",
    "Can authorize stablecoin or card payments",
  ],
  [
    "Tool and agent communication",
    "Expose tools and coordinate agents",
    "MCP, A2A",
    "Payment can be layered onto calls; these are not payment rails",
  ],
] as const;

const walletControls = [
  "isolated keys, or MPC and TEE signing",
  "per-transaction and cumulative spend limits",
  "merchant, protocol, contract, function, asset, and chain allowlists",
  "session and time-bound permissions",
  "human escalation above thresholds",
  "audit logs, revocation, and emergency stops",
  "simulation, threat scanning, and compliance screening",
] as const;

const assurancePhases = [
  [
    "Before construction",
    "Tool permissions, service allowlists, prompt and data provenance.",
  ],
  [
    "During construction",
    "ABI and type validation, quote freshness, slippage and recipient checks.",
  ],
  [
    "Before signing",
    "Fork simulation, balance-delta inspection, threat scanning, sanctions and KYT screening, policy evaluation.",
  ],
  [
    "During settlement",
    "Idempotency, replay protection, MEV protection, confirmation thresholds.",
  ],
  [
    "After settlement",
    "Receipts, delivery proof, reconciliation, anomaly monitoring, refunds, disputes, and incident response.",
  ],
] as const;

const players = [
  [
    "Aomi Labs",
    "2–3",
    "Hosted onchain runtime, tools, construction, simulation, state, and reconciliation",
    "Research and infrastructure focused on execution harnesses above wallets",
  ],
  [
    "Coinbase",
    "2–7",
    "AgentKit, Agentic Wallets, x402, facilitator, stablecoin access, Base",
    "Most vertically integrated crypto stack; wallet and Base distribution are key",
  ],
  [
    "Circle",
    "4–6",
    "USDC, agent wallets, nanopayments, CLI, skills, marketplace",
    "Attempts to make the stablecoin issuer the operating system for agent money",
  ],
  [
    "Stripe and Bridge",
    "5–7",
    "ACP, MPP, x402 support, Link wallet, merchant processing, fiat and stablecoin payouts",
    "Bridges agent protocols to existing merchant operations and payment methods",
  ],
  [
    "Crossmint",
    "3–6",
    "Agent wallets, cards, onramps, checkout, merchant-of-record, credentials",
    "Developer-facing full-stack agent payments API across crypto and cards",
  ],
  [
    "Bankr",
    "1–5",
    "Consumer runtime, wallet, trading, automations, x402 Cloud and discovery",
    "Crypto-native vertical integration and self-funding-agent narrative",
  ],
  [
    "Virtuals",
    "1–5",
    "Agent launch, identity, wallets, jobs, capital, and coordination",
    "Agent economy and marketplace; strong in agent ownership and coordination",
  ],
  [
    "MetaMask",
    "4 + horizontal",
    "Self-custodial wallet, policy, simulation, threat and MEV protection",
    "Wallet distribution and security brand; moving upward into agent execution",
  ],
  [
    "OKX",
    "1, 3–4",
    "Agentic Wallet, OnchainOS, multichain execution and exchange liquidity",
    "Combines wallet, exchange, and route distribution",
  ],
  [
    "Privy",
    "4",
    "Embedded and server wallets, scoped authorization, policies",
    "Modular wallet infrastructure for builders owning the rest of the stack",
  ],
  [
    "Turnkey",
    "4",
    "Enclave signing, policy evaluation, delegated credentials, auditability",
    "Security-first signing infrastructure for production and institutional agents",
  ],
  [
    "MoonPay",
    "4, 6",
    "Open Wallet Standard, onramps, agent cards, multichain access",
    "Connects open agent wallets to consumer funding and card acceptance",
  ],
  [
    "Google",
    "1, 4–5",
    "Gemini surfaces, UCP, AP2 mandates, A2A ecosystem",
    "Standards and distribution; interoperable fiat and crypto authorization",
  ],
  [
    "OpenAI",
    "1, 5",
    "ChatGPT commerce surface and ACP with Stripe",
    "Demand aggregation and conversational distribution",
  ],
  [
    "Visa",
    "4–7",
    "Trusted-agent recognition, credentials, issuer and acquirer network, acceptance",
    "Extends existing trust, disputes, and merchant acceptance to agents",
  ],
  [
    "Mastercard",
    "4–7",
    "Agentic Tokens, Agent Pay, card and machine-payment network",
    "Similar network strategy, increasingly bridging stablecoins and machines",
  ],
  [
    "PayPal",
    "1, 5–7",
    "Consumer wallet, merchant graph, checkout, protection, agent distribution",
    "Closed-loop trust and merchant reach; hybrid agent commerce",
  ],
  [
    "1inch, Uniswap, deBridge, Kraken",
    "3",
    "Protocol or venue-specific tools, skills, MCP servers, liquidity and execution",
    "Own domain depth and routes; suppliers to broader runtimes",
  ],
  [
    "Alchemy and Pimlico",
    "4–7",
    "Smart accounts, bundlers, paymasters, gas sponsorship, RPC",
    "Account-abstraction infrastructure under wallets and runtimes",
  ],
  [
    "Base, Solana, Tempo, Ethereum L2s",
    "7",
    "Low-cost programmable settlement and ecosystems",
    "Compete on cost, finality, liquidity, distribution, and protocol support",
  ],
  [
    "Chainalysis, Blockaid, TRM, Tenderly, Hypernative",
    "Horizontal",
    "KYT, fraud, simulation, threat detection, monitoring, incident response",
    "Independent evidence layer; benefits from provider fragmentation",
  ],
] as const;

const harnessResponsibilities = [
  [
    "Interpret",
    "Bind an adaptive goal to assets, counterparties, timing, budget, and desired state.",
    "Stage 1",
  ],
  [
    "Select",
    "Choose tools, protocols, routes, and payment methods from a controlled capability set.",
    "Stage 2",
  ],
  [
    "Construct",
    "Produce exact orders, calldata, approvals, batches, and payment payloads.",
    "Stage 3",
  ],
  [
    "Simulate",
    "Evaluate the concrete action against relevant state before authority is requested.",
    "Stage 3→4",
  ],
  [
    "Authorize",
    "Bind an immutable request to a wallet or policy boundary that can refuse.",
    "Stage 4 · external",
  ],
  [
    "Execute",
    "Submit once, manage idempotency, and distinguish partial from complete work.",
    "Stages 5–6 · external rails",
  ],
  [
    "Reconcile",
    "Compare receipts and final state with the original objective and preserve evidence.",
    "Stage 7",
  ],
] as const;

const risks = [
  [
    "Prompt injection and tool poisoning",
    "Untrusted content can redirect spending or execution.",
  ],
  [
    "Overbroad delegation",
    "Spend caps alone do not prevent harmful but technically allowed actions.",
  ],
  [
    "Semantic mismatch",
    "A transaction can be valid, simulated, and within policy while failing user intent.",
  ],
  [
    "Replay and duplicates",
    "Retries can create duplicate payments without end-to-end idempotency.",
  ],
  [
    "Stale state",
    "Quotes, balances, gas, liquidity, and permissions change between simulation and settlement.",
  ],
  [
    "Delivery-versus-payment atomicity",
    "Payment finality does not prove correct offchain delivery.",
  ],
  [
    "Identity and Sybil risk",
    "Cheap agent creation undermines reputation and marketplace quality.",
  ],
  [
    "Liability ambiguity",
    "Failures can involve user, model, runtime, tool, wallet, facilitator, merchant, issuer, or chain.",
  ],
  [
    "Privacy",
    "Payment metadata reveals tasks, services, counterparties, and commercial intent.",
  ],
  [
    "Regulatory classification",
    "Custody, transmission, initiation, brokerage, advice, and sanctions obligations vary.",
  ],
  [
    "Economics",
    "Sub-cent payments require cheap settlement, batching, or sessions.",
  ],
  [
    "Fragmentation",
    "Overlapping protocols, wallets, tokens, networks, and frameworks raise integration cost.",
  ],
  [
    "Metric quality",
    "Counts can be gamed by incentives, speculative loops, or self-payments.",
  ],
] as const;

const checklist = [
  ["Who owns the user or task?", "Surface and application"],
  ["Who runs the model loop and task state?", "Runtime and orchestration"],
  ["Who constructs the exact order or transaction?", "Domain execution"],
  [
    "Who holds the credential and can refuse to sign?",
    "Wallet and authorization",
  ],
  [
    "Who defines the payment request and acceptance handshake?",
    "Protocol or orchestrator",
  ],
  [
    "Who supplies and manages the money?",
    "Stablecoin, account, card, onramp, treasury",
  ],
  ["Who provides finality?", "Chain, card network, or bank rail"],
  [
    "Who independently verifies risk and records evidence?",
    "Trust and compliance",
  ],
  [
    "Who bears loss, refund, dispute, and regulatory liability?",
    "Often the clearest layer indicator",
  ],
  [
    "Can each layer be replaced independently?",
    "If not, vertical integration creates convenience and lock-in",
  ],
] as const;

const references = [
  [
    "1",
    "International Monetary Fund",
    "How Agentic AI Will Reshape Payments",
    "https://www.imf.org/en/-/media/files/publications/imf-notes/2026/english/insea2026004.pdf",
  ],
  [
    "2",
    "x402",
    "Protocol introduction and payment flow",
    "https://docs.x402.org/introduction",
  ],
  [
    "3",
    "Stripe and Tempo",
    "Introducing the Machine Payments Protocol",
    "https://stripe.com/blog/machine-payments-protocol",
  ],
  [
    "4",
    "Google Cloud",
    "Announcing the Agent Payments Protocol (AP2)",
    "https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol",
  ],
  [
    "5",
    "Chainalysis",
    "Inside x402's Path to Meaningful Adoption",
    "https://www.chainalysis.com/blog/x402-agentic-payments-adoption/",
  ],
  [
    "6",
    "Coinbase Developer Platform",
    "AgentKit architecture",
    "https://docs.cdp.coinbase.com/agent-kit/core-concepts/architecture-explained",
  ],
  [
    "7",
    "Aomi Labs",
    "Runtime reference",
    "https://aomi.dev/docs/reference/runtime",
  ],
  ["8", "Aomi Labs", "Build overview", "https://aomi.dev/docs/build/overview"],
  [
    "9",
    "Stripe and OpenAI",
    "Agentic Commerce Protocol and Instant Checkout",
    "https://stripe.com/newsroom/news/stripe-openai-instant-checkout",
  ],
  [
    "10",
    "Visa",
    "Trusted Agent Protocol specifications",
    "https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/",
  ],
  [
    "11",
    "Mastercard",
    "Mastercard Agent Pay",
    "https://www.mastercard.com/global/en/business/artificial-intelligence/mastercard-agent-pay.html",
  ],
  [
    "12",
    "Coinbase Developer Platform",
    "Agentic Wallets",
    "https://www.coinbase.com/developer-platform/products/agentic-wallets",
  ],
  [
    "13",
    "MetaMask",
    "Agent Wallet",
    "https://metamask.io/news/metamask-launches-agent-wallet-giving-ai-agents-full-defi-access-with-default-security-on-every-transaction",
  ],
  ["14", "Privy", "Wallet infrastructure for AI", "https://www.privy.io/ai"],
  [
    "15",
    "Turnkey",
    "Wallet infrastructure for AI agents",
    "https://www.turnkey.com/solutions/ai-agents",
  ],
  [
    "16",
    "Bankr",
    "Agent runtime overview",
    "https://docs.bankr.bot/agent/overview/",
  ],
  [
    "17",
    "Aomi Labs Research",
    "Agentic Payments in Crypto — Ecosystem Deep Dive",
    "https://app.notion.com/p/3ba36be0954d816784a4e7b25ba2949b?pvs=204",
  ],
  ["18", "Solana", "What is x402", "https://solana.com/x402/what-is-x402"],
  ["19", "Circle", "Agent Stack", "https://www.circle.com/agent-stack"],
  [
    "20",
    "x402",
    "Facilitator specification",
    "https://docs.x402.org/core-concepts/facilitator",
  ],
  [
    "21",
    "x402",
    "Network and token support",
    "https://docs.x402.org/core-concepts/network-and-token-support",
  ],
  [
    "22",
    "OKX",
    "OKX Wallet officially launches Agentic Wallet",
    "https://www.okx.com/en-gb/help/okx-wallet-officially-launches-agentic-wallet",
  ],
  [
    "23",
    "Crossmint",
    "Agentic payments",
    "https://www.crossmint.com/solutions/agentic-payments",
  ],
  [
    "24",
    "MoonPay",
    "Open Wallet Standard",
    "https://www.moonpay.com/newsroom/open-wallet-standard",
  ],
  ["25", "Virtuals", "EconomyOS", "https://www.virtuals.io/"],
  [
    "26",
    "Chainalysis",
    "AI, Crypto, and Agentic Payments",
    "https://www.chainalysis.com/blog/ai-and-crypto-agentic-payments/",
  ],
  ["27", "Tempo", "Documentation", "https://docs.tempo.xyz/"],
  [
    "28",
    "Harvey",
    "Introducing Agents in Harvey",
    "https://www.harvey.ai/blog/introducing-harvey-agents",
  ],
  [
    "29",
    "Abridge",
    "Generative AI Platform for Clinical Conversations",
    "https://www.abridge.com/product",
  ],
  [
    "30",
    "Hippocratic AI",
    "A Multi-step Process to Ensure Safety",
    "https://hippocraticai.com/safety/",
  ],
  [
    "31",
    "Tenderly",
    "Simulation infrastructure for onchain operations",
    "https://tenderly.co/",
  ],
  [
    "32",
    "Blockaid",
    "How to Build Smarter, Safer Onchain AI Agents with Blockaid",
    "https://www.blockaid.io/blog/how-to-build-smarter-safer-onchain-ai-agents-with-blockaid",
  ],
  [
    "33",
    "Visa and Artemis",
    "Agentic Payments: What Onchain Data Reveals About Commerce",
    "https://www.visa.com/en-us/thought-leadership/innovation/agentic-payments-from-the-ground-up",
  ],
] as const;

function Cite({ n }: { n: string }) {
  return (
    <sup className={styles.cite}>
      <a href={`#ref-${n}`}>[{n}]</a>
    </sup>
  );
}

/** Sixty-odd company names across seven rows read as a wall of prose. The mark
 *  gives each one a shape the eye recognises before it reads the word, which is
 *  what makes a layer scannable. Aomi Labs carries the house bubble, not a favicon. */
function Players({ of }: { of: readonly Player[] }) {
  return (
    <div className={styles.players}>
      {of.map(([name, mark]) => (
        <span
          className={[
            styles.player,
            mark ? "" : styles.playerBare,
            mark === "aomi" ? styles.playerAomi : "",
          ].join(" ")}
          key={name}
        >
          {mark ? (
            <img
              src={
                mark === "aomi"
                  ? "/assets/images/bubble.svg"
                  : `${marksDir}/${mark}.png`
              }
              alt=""
              aria-hidden="true"
              className={styles.playerMark}
            />
          ) : null}
          {name}
        </span>
      ))}
    </div>
  );
}

function MapNodes({
  of,
  from,
}: {
  of: readonly (readonly [string, string, string])[];
  from: number;
}) {
  return (
    <>
      {of.map(([title, examples, role], i) => (
        <div
          className={`${styles.posNode} ${
            (from + i) % 2 === 0 ? styles.posLeft : styles.posRight
          }`}
          key={title || `spacer-${from + i}`}
        >
          {title ? (
            <>
              <b>{title}</b>
              <span>{examples}</span>
              {role ? <em>{role}</em> : null}
            </>
          ) : null}
        </div>
      ))}
    </>
  );
}

function Figure({
  number,
  title,
  children,
  caption,
}: {
  number: string;
  title: string;
  children: ReactNode;
  caption: ReactNode;
}) {
  return (
    <figure className={styles.figure}>
      <div className={styles.figureTopline}>
        <span>Figure {number}</span>
        <b>{title}</b>
      </div>
      <div className={styles.figureBody}>{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Section({
  number,
  title,
  children,
  id,
}: {
  number: string;
  title: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <section className={styles.section} id={id}>
      <div className={styles.sectionRule}>
        <span>{number}</span>
      </div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function ExecutionHarnessesResearch({ post }: Props) {
  return (
    <main className={styles.page}>
      <article className={styles.paper}>
        {/* No masthead: the shared marketing nav supplies the logo and home
            link, and the date already appears in the byline below. */}
        <header className={styles.header}>
          <p className={styles.series}>
            Research paper · Agentic financial infrastructure
          </p>
          <h1>The State of Execution Harnesses for Agentic Payments</h1>
          <p className={styles.subtitle}>
            Breaking down the seven-layer agentic payments stack and identifying
            the missing execution harness that makes financial agents efficient,
            reliable, and operational.
          </p>
          <div className={styles.byline}>
            <span>Aomi Labs Research</span>
            <span>{post.date}</span>
            <span>Market structure and systems analysis</span>
          </div>
        </header>

        <figure className={styles.cover}>
          <img
            src={post.cover}
            alt=""
            width={1600}
            height={900}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </figure>

        <aside className={styles.abstract}>
          <h2>Abstract</h2>
          <p>
            Agentic payments are often described as a new payment method, but
            they are not a single rail or product. They are a seven-layer system
            that begins with agent-facing demand and ends in deterministic
            settlement, with assurance running across every layer. This paper
            maps that stack, places the major actors within it, and assesses the
            use cases and emerging services most likely to mature first. The map
            exposes an unresolved responsibility between adaptive reasoning and
            financial authority: converting an agent&apos;s plan into a concrete
            action, testing it against live state, preserving the payload
            presented for authorization, executing without duplication, and
            proving the intended outcome. We interpret this as the financial
            instance of a broader shift toward domain-specific harnesses:
            systems that surround general models with trusted context,
            structured workflows, authority boundaries, and domain-specific
            evaluation. The execution harness is distinct from models,
            toolkits, wallets, payment protocols, and settlement rails because
            it is accountable for stateful completion across them. A useful
            harness should help the same model complete the same task more
            reliably, with fewer tokens, delays, retries, unsafe actions, and
            human interventions. We argue that harness interfaces may
            standardize as the market matures, while execution quality remains
            differentiated.
          </p>
          <p className={styles.keywords}>
            <b>Keywords:</b> agentic payments, agentic finance, execution
            harnesses, stablecoins, wallets, x402, MPP, AP2, onchain agents
          </p>
        </aside>

        <div className={styles.thesisBox}>
          <b>Bottom line</b>
          <p>
            Agentic payments are a seven-layer stack that begins with adaptive
            demand and ends in deterministic settlement. Most layers already
            have clear categories: applications, runtimes, wallets, payment
            protocols, money infrastructure, and settlement rails. Legal and
            clinical AI show the broader specialization pattern: general models
            become operational through domain knowledge, structured workflows,
            controls, and outcome-specific evaluation. Financial execution needs
            its own domain-specific harness: machinery that reliably carries an
            agent&apos;s intent across the seven layers and proves that the requested
            outcome occurred.
          </p>
        </div>

        <nav className={styles.contents} aria-label="Contents">
          <b>Contents</b>
          {[
            ["1", "The seven-layer stack", "ecosystem"],
            ["2", "Scope, definitions, and method", "method"],
            ["3", "The seven-layer ecosystem", "layers"],
            ["4", "Emerging services, evidence, and maturity", "evidence"],
            ["5", "The missing execution harness", "harness"],
            ["6", "Players, emerging services, and market structure", "actors"],
            ["7", "Harness economics and measurement", "measurement"],
            ["8", "Aomi Labs’ thesis", "aomi"],
            ["9", "Risks, outlook, and conclusion", "conclusion"],
          ].map(([n, label, id]) => (
            <a key={id} href={`#${id}`}>
              <span>{n}</span>
              {label}
            </a>
          ))}
        </nav>

        <Section
          number="1"
          title="The seven-layer agentic payments stack"
          id="ecosystem"
        >
          <p className={styles.lead}>
            We identify seven layers that together carry an agentic payment from
            an adaptive goal to deterministic movement of value. Each layer owns
            a distinct responsibility, and no single protocol, wallet, runtime,
            or rail represents the whole system.
          </p>
          <p>
            Reading downward, agent surfaces originate demand; runtimes maintain
            the task; domain execution converts a plan into concrete actions;
            wallets and mandates control authority; payment protocols coordinate
            acceptance; funding systems supply value; and settlement rails
            provide finality. Trust, security, compliance, observability, and
            reconciliation cut horizontally across all seven layers.
          </p>
          <Figure
            number="1"
            title="Seven layers from adaptive demand to deterministic settlement"
            caption={
              <>
                A company may operate across several layers. The taxonomy
                assigns functions, not permanent identities.
                Assurance—simulation, compliance, threat detection,
                observability, disputes, and reconciliation—cuts horizontally
                across the stack.
              </>
            }
          >
            <div className={styles.stack}>
              {layers.map(([n, name, job, players]) => (
                <div
                  className={`${styles.layer} ${n === "02" || n === "03" ? styles.focusLayer : ""}`}
                  key={n}
                >
                  <span>{n}</span>
                  <div>
                    <b>{name}</b>
                    <p>{job}</p>
                  </div>
                  <Players of={players} />
                </div>
              ))}
              <div className={styles.assurance}>
                <b>Horizontal assurance</b>
                {[
                  "simulation",
                  "compliance",
                  "threat detection",
                  "observability",
                  "reconciliation",
                  "disputes",
                ].map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </Figure>
          <p>
            This stack is the paper&apos;s starting point. It separates adjacent
            markets before asking where responsibility is still incomplete.
            The gap appears between adaptive planning and financial authority:
            someone must construct, test, execute, recover, and reconcile the
            action across the other layers. Section 5 names that missing
            category only after the market evidence and boundaries are clear.
          </p>
        </Section>

        <Section
          number="2"
          title="Scope, definitions, and methodology"
          id="method"
        >
          <h3>2.1 What counts as an agentic payment?</h3>
          <p>
            A conventional automated payment follows predetermined code: send a
            fixed amount on a fixed date. An agentic payment contains an
            adaptive decision step: find a compliant supplier under a budget,
            choose a route, determine the amount or timing, and pay. The agent
            may decide <i>what</i>, <i>when</i>, <i>where</i>, or{" "}
            <i>how much</i> within a delegated mandate.
          </p>
          <p>
            A complete agentic payment requires more than a checkout button. It
            runs through seven stages, and the stages do not share the same
            character: the first three are adaptive and reversible, while the
            last four must be deterministic.
          </p>
          <Figure
            number="2"
            title="The seven stages of a complete agentic payment"
            caption={
              <>
                Stages 1–3 are adaptive and still reversible. Stage 4 is the
                authorization boundary: a deterministic decision about whether
                the constructed request may use financial authority. Stages 5–7
                must fund, settle, and reconcile without reinterpreting the
                instruction.
              </>
            }
          >
            <div className={`${styles.lifecycle} ${styles.flow}`}>
              {paymentStages.map(([name, description], i) => (
                <div key={name}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <b>{name}</b>
                  <p>{description}</p>
                </div>
              ))}
            </div>
            <div className={styles.boundary}>
              <span>Probabilistic reasoning</span>
              <span>Deterministic authority and settlement</span>
            </div>
          </Figure>
          <p>
            Agentic payments overlap with two larger categories but are not
            synonymous with either. <b>Agentic commerce</b> includes discovery,
            comparison, ordering, fulfillment, returns, and support; payment is
            one stage. <b>Agentic finance</b> includes trading, treasury,
            hedging, lending, compliance, and portfolio operations; not every
            financial action is a payment. A crypto agent that only analyzes or
            communicates becomes a payment actor only when it can request or
            authorize value transfer.
          </p>
          <Figure
            number="3"
            title="Finance is the umbrella. Payments are one action class."
            caption={
              <>
                Agentic payments are a subset of agentic finance and an action
                inside commerce workflows. Commerce and finance overlap, but
                neither contains the other. The diagram maps responsibilities,
                not company categories.
              </>
            }
          >
            <div className={styles.domainMapScroll}>
              <div className={styles.domainMap}>
                <div className={styles.financeDomain}>
                  <div className={styles.domainLabel}>
                    <b>Agentic finance</b>
                    <p>
                      Research · trading · treasury · lending · risk ·
                      compliance · financial operations
                    </p>
                  </div>
                  <div className={styles.paymentsDomain}>
                    <b>Agentic payments</b>
                    <p>Authorize · route · transfer · settle · reconcile</p>
                  </div>
                </div>
                <div className={styles.commerceDomain}>
                  <b>Agentic commerce</b>
                  <p>Discover · compare · negotiate · procure · book</p>
                </div>
                <div className={styles.domainTest}>
                  <b>Useful test</b>
                  <p>
                    A payment moves value. Finance decides how capital should be
                    understood, allocated, protected, or operated.
                  </p>
                </div>
                <div className={styles.domainLegend} aria-label="Diagram key">
                  <span>Umbrella</span>
                  <span>Subset</span>
                  <span>Overlap</span>
                </div>
              </div>
            </div>
          </Figure>
          <h3>2.2 The probabilistic–deterministic boundary</h3>
          <p>
            The IMF&apos;s 2026 model separates agentic payments into intent and
            orchestration, control and authorization, and settlement.
            <Cite n="1" />
            That separation captures the core safety property: an agent may
            reason, search, negotiate, and propose, but a deterministic boundary
            must decide whether a concrete request may use financial authority,
            and a deterministic rail must settle without reinterpreting the
            instruction. This paper expands the commercial and technical space
            between those three institutional layers.
          </p>
          <h3>2.3 Research method</h3>
          <p>
            The analysis combines official protocol specifications, first-party
            product documentation, independent onchain evidence, and Aomi
            Labs&apos; operating perspective. The market taxonomy, player map, and
            use-case maturity assessments extend an earlier ecosystem deep dive
            published by Aomi Labs Research in August 2026, which remains the
            underlying survey for this paper.
            <Cite n="17" /> Product capabilities are treated as vendor claims
            unless independently demonstrated. Transaction activity is evidence
            of technical use, not automatically evidence of durable or
            autonomous demand. The market taxonomy is analytical: firms often
            span multiple layers, and placement reflects the function being
            evaluated rather than the company as a whole.
          </p>
          <div className={styles.methodGrid}>
            <div>
              <b>Included</b>
              <p>
                Machine payments, commerce mandates, crypto wallets,
                stablecoins, agent runtimes, DeFi execution, treasury, security,
                and reconciliation.
              </p>
            </div>
            <div>
              <b>Excluded</b>
              <p>
                Generic AI fraud models, infrastructure with no agent-facing
                role, and speculative tokens whose only connection is an “AI
                agent” label.
              </p>
            </div>
            <div>
              <b>Evidence hierarchy</b>
              <p>
                Specifications first; then official technical documentation;
                then independent market evidence; finally internal hypotheses
                and positioning.
              </p>
            </div>
            <div>
              <b>Research limitation</b>
              <p>
                The same-model execution advantage is proposed as a benchmark.
                No unrun comparison is presented as a measured result.
              </p>
            </div>
          </div>
        </Section>

        <Section
          number="3"
          title="The seven-layer ecosystem"
          id="layers"
        >
          <p>
            The seven-layer model becomes useful when it assigns each function
            to the actors that actually perform it. A protocol, wallet, runtime,
            funding provider, or settlement rail may span several layers, but
            no one label should be mistaken for the whole system.
          </p>
          <h3>Layer 1 — Agent surfaces and vertical applications</h3>
          <p>
            Agent surfaces own the user or business workflow and originate
            demand. OpenAI and Stripe&apos;s Agentic Commerce Protocol, for
            example, allows a conversational surface to pass a structured order
            and a scoped payment token to a merchant while the merchant retains
            responsibility for acceptance and fulfillment.
            <Cite n="9" /> Crypto surfaces go further. Bankr combines a
            conversational agent, wallet, cross-chain trading, scheduled
            automations, and x402 service access in one runtime.
            <Cite n="16" /> Virtuals&apos; EconomyOS gives agents identity,
            wallets, permissions, jobs, and programmable capital, with its own
            Agent Commerce Protocol for inter-agent work.
            <Cite n="25" /> That Virtuals “ACP” is a different specification
            from the Stripe and OpenAI Agentic Commerce Protocol despite the
            shared acronym.
          </p>
          <h3>Layer 2 — Agent runtime and orchestration</h3>
          <p>
            Beneath the surface, runtimes own sessions, memory, tools, retries,
            background work, and multistep state. Toolkits and runtimes should
            be distinguished: Coinbase describes AgentKit as a modular,
            framework- and wallet-agnostic system of action providers and wallet
            providers.
            <Cite n="6" /> A stateful execution runtime goes further by owning
            the path to completion and the evidence left behind.
          </p>
          <h3>
            Layer 3 — Domain execution and transaction construction
          </h3>
          <p>
            Domain-execution providers then supply the exact mechanics of a
            swap, bridge, order, checkout, staking operation, or protocol call.
            This is where generic tool calling becomes domain execution: ABI
            handling, route selection, calldata construction, balance and
            allowance checks, slippage, gas, bridge state, failure semantics,
            and post-execution verification. Vertical providers are strong while
            the action stays inside their domain — 1inch Business MCP for swaps
            and portfolios, deBridge MCP for cross-chain routing, Uniswap skills
            for liquidity workflows, Kraken CLI and MCP for exchange trading and
            staking, Crossmint for agentic checkout and merchant-of-record
            flows. The unresolved question is whether execution consolidates
            into broad runtimes or remains a federation of protocol-owned tools.
            The likely answer is both: broad runtimes orchestrate, while
            specialists own routes, liquidity, inventory, and domain-specific
            guarantees.
          </p>
          <h3>Layer 4 — Identity, mandates, wallets, and signing</h3>
          <p>
            Layer four is becoming the center of competition. Google&apos;s AP2
            binds an agent&apos;s action to cryptographically verifiable
            mandates describing identity, scope, limits, and conditions, and
            includes an x402 extension for stablecoin payments.
            <Cite n="4" />
            Visa&apos;s Trusted Agent Protocol helps a merchant recognize an
            approved agent and verify cryptographically signed commerce intent;
            Mastercard Agent Pay extends tokenized credentials and network
            controls to agents.
            <Cite n="10" />
            <Cite n="11" /> Crypto wallets are evolving from key stores into
            programmable authorization systems with:
          </p>
          <ul className={styles.priorities}>
            {walletControls.map((control) => (
              <li key={control}>{control}</li>
            ))}
          </ul>
          <p>
            The crypto-native wallet models are diverging rather than
            converging. Coinbase Agentic Wallets isolate keys in a TEE and add
            session and transaction caps, KYT screening, x402, and gasless
            trading on Base.
            <Cite n="12" /> MetaMask Agent Wallet stays self-custodial and makes
            simulation mandatory, with Blockaid scanning, MEV protection, spend
            limits, allowlists, and human 2FA escalation.
            <Cite n="13" /> OKX pairs TEE-protected keys and risk scoring with
            gas-free X Layer use across nearly twenty chains.
            <Cite n="22" /> Privy provides server wallets and scoped browser
            authorization while Turnkey evaluates signing policies inside secure
            enclaves.
            <Cite n="14" />
            <Cite n="15" /> MoonPay&apos;s Open Wallet Standard proposes an open
            agent-to-wallet interface with a local encrypted vault and
            multichain signing.
            <Cite n="24" /> Crossmint and Circle instead sell the full stack:
            wallets, policies, funding, payment protocols, and service access in
            one integration.
            <Cite n="23" />
            <Cite n="19" />
          </p>
          <h3>
            Layer 5 — Payment coordination and acceptance protocols
          </h3>
          <p>
            Layer five tells an agent what is for sale, how much it costs, which
            payment methods are accepted, what proof is required, and how the
            service is delivered. These protocol families are frequently
            conflated and should not be.
          </p>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                Table 1. Protocol families and what each one actually
                standardizes
              </caption>
              <thead>
                <tr>
                  <th>Protocol family</th>
                  <th>Primary job</th>
                  <th>Examples</th>
                  <th>Crypto role</th>
                </tr>
              </thead>
              <tbody>
                {protocolFamilies.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, i) => (
                      <td key={i}>{i === 0 ? <b>{cell}</b> : cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The distinction in the last row matters most. MCP and A2A expose
            tools and coordinate agents; payment can be layered onto their
            calls, but they are not payment rails. Within machine payments, x402
            facilitators verify signed payloads and submit settlement without
            custodying funds.
            <Cite n="20" /> MPP, co-authored by Stripe and Tempo, coordinates
            payment for APIs, MCP tools, and HTTP endpoints and supports
            microtransactions and recurring charges, reaching stablecoins,
            cards, and buy-now-pay-later methods while preserving tax, fraud,
            reporting, refunds, and normal merchant payouts.
            <Cite n="3" /> ACP and UCP address commerce rather than raw payment:
            ACP lets an agent surface pass a structured order and scoped token
            to a merchant who remains responsible for acceptance, tax,
            fulfillment, and returns, while UCP standardizes discovery and
            checkout across surfaces. The competitive boundary is whether
            merchants adopt an open protocol directly or rely on an orchestrator
            — Stripe, Coinbase, Circle, Crossmint, Bankr — to hide the protocol
            complexity.
          </p>
          <h3>Layer 6 — Money, funding, and treasury infrastructure</h3>
          <p>
            Stablecoins are the default crypto asset for agentic payments
            because agents need predictable unit pricing, 24/7 availability,
            global reach, programmability, and settlement smaller than
            card-network minimum economics. Circle claims USDC represents 99.8%
            of x402 transaction value and has built agent wallets, nanopayments,
            a CLI, skills, and a service marketplace around that position.
            <Cite n="19" /> Treat that percentage as a current vendor-reported
            ecosystem statistic, not a permanent market share.
          </p>
          <p>
            Funding remains the bottleneck. An agent wallet without reliable
            onramps, treasury policies, gas sponsorship, balance monitoring, FX,
            and accounting is only a demo — which is why full-stack providers
            keep bundling these functions rather than leaving customers to
            assemble separate wallet, onramp, facilitator, and compliance
            vendors.
          </p>
          <h3>Layer 7 — Settlement rails</h3>
          <p>
            At layer seven, different rails win different jobs. Base offers
            cheap EVM settlement with x402 and Coinbase distribution; Solana
            offers throughput and low fees with strong stablecoin and
            marketplace activity; Tempo is payment-optimized and the native home
            for MPP sessions and streaming payments;
            <Cite n="27" /> Ethereum and its L2s hold the deepest
            programmable-finance and account-abstraction ecosystem; card
            networks retain unmatched merchant acceptance, disputes, consumer
            protection, and issuer controls; bank rails carry regulated
            account-to-account flows, payroll, and fiat-native settlement. The
            likely endpoint is cross-rail orchestration, not a crypto-only or
            card-only world.
          </p>
          <h3>3.1 Horizontal assurance across all seven layers</h3>
          <p>
            Trust, security, compliance, and observability do not sit at one
            level. They cut across all seven, and the controls divide cleanly by
            when they run.
          </p>
          <div className={styles.metrics}>
            {assurancePhases.map(([phase, controls]) => (
              <div key={phase}>
                <b>{phase}</b>
                <p>{controls}</p>
              </div>
            ))}
          </div>
          <p>
            Chainalysis combines KYT, sanctions screening, fraud intelligence,
            and pre-signing threat detection, and argues for auditable autonomy
            rather than unconstrained automation.
            <Cite n="26" /> This horizontal layer is likely to become a major
            standalone market precisely because neither a model nor a wallet can
            independently validate the entire economic outcome. These
            responsibilities can be vertically integrated for convenience, but
            they carry different competencies and liabilities, and mature buyers
            will require the boundaries to remain inspectable even when one
            provider bundles several layers.
          </p>
        </Section>

        <Section
          number="4"
          title="Emerging service sectors, evidence, and maturity"
          id="evidence"
        >
          <h3>4.1 Emerging service sectors</h3>
          <p className={styles.lead}>
            Financial agents need more than access to money. To operate beyond
            demos, they must receive bounded authority, find trustworthy
            counterparties, execute correctly, choose the right rail, and remain
            accountable after settlement. Each unresolved need creates a market
            for specialized infrastructure.
          </p>
          <p>
            Authority must be both programmable and attributable. Credentials
            need isolation, mandates must encode scope and limits, and merchants
            must know which agent is acting for which principal. This creates two
            related but distinct markets: wallets that control access to money,
            and identity, mandate, and reputation systems that establish the
            legitimacy of its use.
            <Cite n="12" />
            <Cite n="14" />
            <Cite n="15" />
          </p>
          <p>
            Markets must also become legible and usable by software. Agents need
            structured descriptions of services, prices, schemas, and delivery
            terms; sellers need gateways that abstract verification and
            settlement. Discovery without reputation becomes spam, while
            payment without delivery proof invites fraud, so marketplaces will
            increasingly incorporate attestations, service histories, and
            escrow.
          </p>
          <p>
            A valid payment is not necessarily a correct action. Systems must
            test transaction semantics before signing, verify the resulting
            state, and select among stablecoin, card, bank, and local rails
            according to the task&apos;s economic and regulatory requirements. This
            separates execution assurance, which determines what should happen,
            from payment orchestration, which determines how value should move.
          </p>
          <p>
            Finally, autonomous spending must close the operational loop. Every
            balance change, receipt, gas cost, refund, and tax event must map back
            to an agent, mandate, task, user, and result. When the result is
            wrong, settlement finality is insufficient; the system still needs
            proof of delivery, recourse, and a clear allocation of liability.
          </p>
          <div className={styles.serviceGrid}>
            {serviceSectors.map(([title, description, examples]) => (
              <article className={styles.serviceCard} key={title}>
                <h4>{title}</h4>
                <p>{description}</p>
                <small>{examples}</small>
              </article>
            ))}
          </div>
          <h3>4.2 Market evidence</h3>
          <p className={styles.lead}>
            Evidence now appears across all eight service sectors, but they are
            not maturing at the same rate.
          </p>
          <p>
            Productization is clearest in authority, identity, discovery, and
            payment access. Coinbase, Circle, MetaMask, Privy, Turnkey, and OKX
            now offer agent wallets or delegated controls.
            <Cite n="12" />
            <Cite n="13" />
            <Cite n="14" />
            <Cite n="15" />
            <Cite n="19" />
            <Cite n="22" /> Google&apos;s AP2, Visa Trusted Agent Protocol, and
            Mastercard Agent Pay formalize mandates and agent recognition.
            <Cite n="4" />
            <Cite n="10" />
            <Cite n="11" /> Circle has launched an agent marketplace alongside
            wallets and nanopayments, while x402 and MPP supply gateway
            protocols.
            <Cite n="2" />
            <Cite n="3" /> Usage is material but noisy: Chainalysis measured
            more than 100 million x402 transactions on Base through Q1 2026,
            while Solana reports more than 35 million transactions and over $10
            million in volume. Speculative activity drove part of the earlier
            surge, so these figures demonstrate technical reach rather than
            durable autonomous demand.
            <Cite n="5" />
            <Cite n="18" />
          </p>
          <p>
            Execution and operations are also taking shape. Tenderly offers
            live-state simulation, Blockaid exposes agent-focused transaction
            scanning and threat detection, and Crossmint routes cards and
            stablecoins under common controls.
            <Cite n="31" />
            <Cite n="32" />
            <Cite n="23" /> Stripe carries MPP payments into existing tax,
            reporting, accounting, and refund systems.
            <Cite n="3" /> Evidence weakens after settlement: treasury and
            reconciliation mostly extend general payment tooling, while Visa and
            Artemis find no settled way to unwind disputes across chains of
            agents.
            <Cite n="33" /> The market is therefore broader than x402: the first
            six sectors are productizing, while agent-native back-office and
            recourse remain open categories.
          </p>
          <h3>4.3 Use-case maturity</h3>
          <p>
            Use cases mature fastest when the purchased object is digital, the
            price is machine-readable, fulfillment is immediate, and failure is
            reversible or low value. They mature more slowly as physical
            fulfillment, regulated advice, custody, credit, cross-border
            compliance, or ambiguous liability enters the workflow.
          </p>
          <Figure
            number="4"
            title="Use-case maturity versus workflow and liability complexity"
            caption={
              <>
                Maturity is read from Table 2, which follows. Complexity and
                market size are
                assessments, not measurements, so the axes are drawn as named
                zones and bubble area as four steps rather than numeric scales.
                Size asks how much spend a category could eventually address,
                which is why treasury and procurement stay large while sitting
                low on maturity. Colour restates the maturity band. The trend is
                the report&apos;s own claim — value falls as physical
                fulfilment, regulated advice, custody, credit, or ambiguous
                liability enters the workflow — and the informative part is the
                exception. Compliance and investigation workflows sit high on
                complexity and high on maturity because a human stays
                accountable at the end of them.
              </>
            }
          >
            <div className={styles.mplotWrap}>
              <svg
                className={styles.mplot}
                viewBox="0 44 980 576"
                role="img"
                aria-label="Bubble chart of eleven agentic payment use cases. Maturity falls as workflow and liability complexity rises. Pay-per-call APIs and infrastructure sessions sit at low complexity and early production; treasury and cross-border sits at high complexity and pilot stage. Compliance workflows is the exception, at high complexity and early production. Bubble area is an assessment of the spend each category could eventually address: consumer shopping, procurement and expense, and treasury and cross-border are the largest, and they are the three that sit lowest on maturity relative to their size."
              >
                {maturityBands.map(([label, top, bottom]) => (
                  <g key={label}>
                    <line
                      className={styles.mgrid}
                      x1="165"
                      x2="930"
                      y1={bottom}
                      y2={bottom}
                    />
                    <text
                      className={styles.mband}
                      x="152"
                      y={(top + bottom) / 2}
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      {label}
                    </text>
                  </g>
                ))}
                <line
                  className={styles.mgrid}
                  x1="165"
                  x2="930"
                  y1="70"
                  y2="70"
                />
                <line
                  className={styles.maxis}
                  x1="165"
                  x2="165"
                  y1="70"
                  y2="440"
                />

                {complexityZones.slice(1).map(([label, from]) => (
                  <line
                    key={label}
                    className={styles.mgrid}
                    x1={from}
                    x2={from}
                    y1="70"
                    y2="440"
                  />
                ))}
                {complexityZones.map(([label, from, to]) => (
                  <text
                    key={label}
                    className={styles.mzone}
                    x={(from + to) / 2}
                    y="464"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                ))}

                <text
                  className={styles.maxisTitle}
                  x="547"
                  y="494"
                  textAnchor="middle"
                >
                  Workflow and liability complexity →
                </text>

                {railSpans.map(([label, from, to, tone]) => (
                  <g
                    key={label}
                    className={tone === "sky" ? styles.mrailA : styles.mrailB}
                  >
                    <line x1={from + 4} x2={to - 4} y1="528" y2="528" />
                    <line x1={from + 4} x2={from + 4} y1="523" y2="533" />
                    <line x1={to - 4} x2={to - 4} y1="523" y2="533" />
                    <text x={(from + to) / 2} y="550" textAnchor="middle">
                      {label}
                    </text>
                  </g>
                ))}

                {maturityPoints.map(([label, x, y, anchor, band, size]) => {
                  const r = bubbleRadius(size);
                  return (
                    <g className={`${styles.mpt} ${bandTone[band]}`} key={label}>
                      <circle cx={x} cy={y} r={r} />
                      <text
                        x={anchor === "start" ? x + r + 9 : x - r - 9}
                        y={y}
                        textAnchor={anchor}
                        dominantBaseline="middle"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                <text
                  className={styles.maxisTitle}
                  transform="translate(28 255) rotate(-90)"
                  textAnchor="middle"
                >
                  2026 maturity →
                </text>

                {/* Size key, on its own row under the plot and flush with the
                    y-axis. Inside the plot it read as a twelfth data point. */}
                <g className={styles.mlegend}>
                  <text x="165" y="590" dominantBaseline="middle">
                    Assessed market size
                  </text>
                  {[1, 2, 4].map((step, i) => (
                    <circle
                      key={step}
                      cx={[325, 368, 418][i]}
                      cy={590}
                      r={bubbleRadius(step)}
                    />
                  ))}
                  <text x="456" y="590" dominantBaseline="middle">
                    niche → very large
                  </text>
                </g>
              </svg>
            </div>
          </Figure>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                Table 2. Representative use cases and 2026 maturity
              </caption>
              <thead>
                <tr>
                  <th>Use case</th>
                  <th>Why agents help</th>
                  <th>Best-fit rails</th>
                  <th>2026 maturity</th>
                </tr>
              </thead>
              <tbody>
                {useCases.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, i) => (
                      <td key={i}>{i === 0 ? <b>{cell}</b> : cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            This sequence explains crypto&apos;s early advantage. Wallets are
            programmatic accounts; stablecoins provide internet-native value;
            and blockchains settle globally at machine speed. Those properties
            are especially valuable for low-value digital services and
            crypto-native financial actions. They are less decisive in consumer
            commerce, where merchant reach, refunds, fraud allocation, tax, and
            fulfillment usually matter more than the novelty of the rail.
          </p>
        </Section>

        <Section number="5" title="The missing execution harness" id="harness">
          <p className={styles.lead}>
            The seven-layer map reveals a responsibility that the market has not
            consistently named: carrying an agent&apos;s adaptive plan into a
            concrete, inspectable, and reconciled financial outcome.
          </p>
          <p>
            General-purpose agents can already reach financial destinations.
            They can browse documentation, discover a tool, infer its schema,
            create a payment or transaction, recover from an error, and inspect
            a receipt. Yet they often do so the way a person travels on foot:
            one uncertain step at a time, repeatedly paying in reasoning,
            tokens, latency, and operational risk.
          </p>
          <p>
            Faster models improve that walk. They do not remove the economic
            reason to build vehicles. In mature technical systems, repeated
            integration knowledge, safety checks, and recovery logic move out of
            general reasoning and into software. The model remains the
            intelligence; an execution harness carries the known mechanics.
          </p>
          <p className={styles.lead}>
            A payment protocol can coordinate a handshake, and a wallet can
            decide whether to sign. Neither can independently establish that an
            adaptive financial task was correctly completed.
          </p>
          <p>
            Consider an instruction to bridge an asset, pay for a service on the
            destination chain, and return a receipt. The agent must interpret
            constraints, select a bridge and service, obtain quotes, construct
            approvals and calls, reason about destination gas, handle changing
            state, preserve the request reviewed by the signer, recover from a
            partial bridge, prevent duplicate payment, verify delivery, and
            reconcile the final balances. A wallet can enforce a spend cap. A
            simulator can test a concrete transaction. A chain can prove
            finality. None alone can connect the semantic objective to the whole
            sequence of evidence.
          </p>
          <div className={styles.thesisBox}>
            <b>Central thesis</b>
            <p>
              As agentic finance matures, execution harnesses become standard
              infrastructure because they increase verified outcomes per unit of
              model reasoning, time, money, and human attention. Their
              interfaces may commoditize; their execution quality will not.
            </p>
          </div>
          <h3>5.1 Definition</h3>
          <p>
            An <b>execution harness</b> is the runtime machinery that converts
            adaptive intent into bounded, inspectable, and reconcilable
            financial action. It is more than a toolkit because it owns state,
            recovery, and completion. It is broader than a policy layer because
            policy does not construct or reconcile the task. It remains separate
            from the wallet because the wallet must retain the independent power
            to refuse.
          </p>
          <p>
            The harness does not replace the seven payment stages in Figure 2;
            it decomposes the work inside them. Its responsibilities cover
            stages one through three, the simulation that precedes the
            authorization request, and the reconciliation that closes the task.
            It never owns stage four. Authority stays with the wallet, funding
            with the balance, and finality with the rail.
          </p>
          <Figure
            number="5"
            title="The execution lifecycle and its authority boundary"
            caption={
              <>
                Each responsibility is annotated with the payment stage from
                Figure 2 that it serves. The critical output is an evidence
                chain linking original intent, selected capability, constructed
                payload, simulation, authorization decision, signer, receipt,
                and final state.
              </>
            }
          >
            <div className={styles.track}>
              {harnessResponsibilities.map(([name, description, stage], i) => (
                <div
                  className={`${styles.tstep} ${i === 4 ? styles.tstepExt : ""}`}
                  key={name}
                  style={{ gridColumn: i + 2, gridRow: i === 4 ? 2 : 1 }}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <b>{name}</b>
                  <p>{description}</p>
                  <small>{stage}</small>
                </div>
              ))}
              <span className={styles.tlaneA}>Execution harness</span>
              <span className={styles.tlaneB}>External authority</span>
              <span className={styles.thandoff} aria-hidden="true">
                ↓ hand off ↑
              </span>
            </div>
          </Figure>
          <h3>5.2 Why better models do not eliminate the category</h3>
          <p>
            General models will continue to improve at documentation discovery,
            schema inference, tool use, and error recovery. That lowers the cost
            of walking; it does not change the value of a tested route. Mature
            systems do not ask a model to rediscover stable protocol knowledge,
            allowance rules, idempotency semantics, receipt formats, or balance
            assertions on every run. They encode those mechanics and reserve
            model reasoning for decisions that are genuinely adaptive.
          </p>
          <p>
            Legal and clinical AI provide an instructive precedent, even though
            those companies do not necessarily use the term “harness.” Harvey
            distinguishes individual models from model systems, agents, and
            workflows. Its legal workflows combine task-specific tools and
            knowledge sources with structured steps, citation requirements,
            human review, and evaluations based on completed legal work.
            <Cite n="28" /> Abridge turns clinical conversations into billable,
            EHR-integrated notes and actionable outputs, tying drafts back to
            source information for clinician review.
            <Cite n="29" /> Hippocratic AI describes a safety process built
            around output testing, clinical supervision, escalation to human
            nurses, and cross-validation against real interactions.
            <Cite n="30" />
          </p>
          <p>
            The shared pattern is not simply more domain knowledge. Stable
            professional mechanics move out of repeated prompting and into
            software that owns workflow, evidence, review, and evaluation.
            Financial execution follows the same pattern with a stricter end
            state: the output can move assets irreversibly. Its domain-specific
            harness must therefore own transaction construction, simulation,
            immutable authorization handoff, idempotency, recovery, and
            reconciliation—not merely produce a more informed financial answer.
          </p>
          <p>
            The analogy must be applied strictly. A poor vehicle can be slower
            than walking. A harness that hides failures, constrains a capable
            model, increases retries, or cannot demonstrate the final state has
            not earned its abstraction. The relevant comparison is the same
            athlete on the same course: one model and task set, with and without
            the harness.
          </p>
        </Section>

        <Section
          number="6"
          title="Player map and market structure"
          id="actors"
        >
          <p>
            Early markets reward full-stack products because developers prefer
            one API and users prefer one trusted surface. Coinbase, Circle,
            Crossmint, Stripe, Bankr, and OKX therefore span layers. Yet
            specialization is likely to deepen because each layer has a distinct
            technical competency, distribution advantage, and liability model.
            Models optimize reasoning; runtimes manage state; wallets control
            authority; protocols coordinate; issuers manage money; rails provide
            finality; risk vendors provide independent evidence. As stakes rise,
            buyers will demand modularity and independent checks.
          </p>
          <div className={styles.tableWrap}>
            <table>
              <caption>
                Table 3. Player map. Layer numbers refer to the seven-layer
                model; “horizontal” means trust, compliance, or security across
                layers
              </caption>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Primary layers</th>
                  <th>What it owns</th>
                  <th>Strategic position</th>
                </tr>
              </thead>
              <tbody>
                {players.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, i) => (
                      <td key={i}>{i === 0 ? <b>{cell}</b> : cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>6.1 Market structure and competitive dynamics</h3>
          <p>
            <b>Wallets own the strongest distribution moat.</b> They already
            control assets, trust, signing, and the gateway to settlement, which
            gives MetaMask, Coinbase, OKX, Phantom, and institutional custody
            providers a path upward into agent controls and execution. Runtimes
            should treat wallets as distribution and authority partners rather
            than as competitors to displace.
          </p>
          <p>
            <b>Protocols converge by function, not toward one standard.</b> x402
            and MPP overlap in machine payments; ACP and UCP overlap in commerce
            workflows; AP2, Visa, and Mastercard focus on mandates and trusted
            agents; MCP and A2A coordinate tools and agents. These can coexist
            because they solve different parts of the journey. Durable providers
            will support several protocols while preserving one stable internal
            authorization and accounting model.
          </p>
          <p>
            <b>Stablecoins are the crypto wedge, not the whole product.</b> They
            solve global, programmable, low-value settlement. They do not solve
            agent identity, merchant acceptance, delivery disputes, refunds,
            taxes, wallet policy, or safe construction. The market will reward
            teams that pair stablecoins with those missing layers.
          </p>
          <p>
            <b>Transaction counts can mislead.</b> The x402 data is promising
            but should not be presented as pure autonomous-agent adoption.
            Chainalysis attributes a major Q4 2025 spike to meme-coin
            pay-to-mint loops and holds that mass adoption remains distant.
            <Cite n="5" />
          </p>
          <p>
            Taken together, these dynamics set the bar for anyone in layers two
            and three. Payment platforms can move inward from money movement
            into orchestration; vertical providers can dominate high-frequency
            domains through route, venue, or inventory depth; general agent
            frameworks can move downward through wallet and payment plugins.
            Execution runtimes must therefore prove that they are materially
            better at generalized completion and evidence, not merely better at
            exposing transactions to an LLM.
          </p>
        </Section>

        <Section
          number="7"
          title="Harness economics and measurement"
          id="measurement"
        >
          <p>
            Model tokens are not the only operational cost, but they reveal the
            underlying inefficiency. When an agent rereads documentation,
            reconstructs schemas, reasons through stable allowance mechanics,
            retries stale routes, or investigates whether a task finished, the
            system is buying cognition to compensate for missing infrastructure.
            Harness value comes from moving repeated cognition into software,
            compressing the failure surface, and making operations legible.
          </p>
          <p>
            This produces a stricter economic claim than “agents work better
            with tools.” A useful harness should increase the number of verified
            outcomes obtained from a fixed model budget. It should also preserve
            model optionality: operators can improve or replace the model
            without rebuilding every financial integration and control around
            it.
          </p>
          <Figure
            number="6"
            title="A same-model benchmark for execution leverage"
            caption={
              <>
                Hold the model, prompt, task suite, signer policy, starting
                state, and market conditions constant. Score the resulting world
                state—not the fluency of the transcript.
              </>
            }
          >
            <div className={styles.benchmark}>
              <div>
                <span>Baseline</span>
                <b>General tools</b>
                <p>
                  Model discovers interfaces, reconstructs mechanics, recovers
                  from failures, and verifies completion during each run.
                </p>
              </div>
              <div className={styles.versus}>
                same model
                <br />
                same tasks
              </div>
              <div className={styles.benchmarkFocus}>
                <span>Harnessed</span>
                <b>Tested execution path</b>
                <p>
                  Software supplies typed actions, simulation, state, recovery,
                  payload binding, and outcome assertions.
                </p>
              </div>
            </div>
            <div className={styles.formula}>
              <b>Execution leverage</b>
              <span>verified outcomes</span>
              <i>÷</i>
              <span>tokens + time + failures + intervention</span>
            </div>
          </Figure>
          <h3>7.1 Proposed scorecard</h3>
          <div className={styles.metrics}>
            <div>
              <b>Task success</b>
              <p>Did the requested financial state change occur?</p>
            </div>
            <div>
              <b>Tokens per verified outcome</b>
              <p>How much model reasoning was consumed by completed work?</p>
            </div>
            <div>
              <b>Time, calls, and retries</b>
              <p>How much latency, wandering, and recovery occurred?</p>
            </div>
            <div>
              <b>Human intervention</b>
              <p>
                How often did the system need rescue rather than intentional
                approval?
              </p>
            </div>
            <div>
              <b>Unsafe proposals blocked</b>
              <p>Did it reject structurally valid but harmful actions?</p>
            </div>
            <div>
              <b>Simulation consistency</b>
              <p>
                Was the signed payload the reviewed payload, and did execution
                match simulation?
              </p>
            </div>
            <div>
              <b>Duplicate-broadcast rate</b>
              <p>Did retries create repeated payments or transactions?</p>
            </div>
            <div>
              <b>End-state evidence</b>
              <p>
                Can the result be tied back to intent, authority, receipts, and
                final state?
              </p>
            </div>
          </div>
          <p>
            The benchmark should include ordinary success and adversarial state:
            stale quotes, changed allowances, rejected signatures, insufficient
            destination gas, partial bridge completion, delayed confirmation,
            unavailable tools, malicious content, and repeated network requests.
            A harness is valuable only if its advantage survives these
            conditions.
          </p>
        </Section>

        <Section number="8" title="Aomi Labs’ thesis" id="aomi">
          <p className={styles.lead}>
            Our thesis at Aomi Labs is that agentic finance will require a
            distinct execution-harness layer. Our work focuses on its onchain
            instance: infrastructure that turns agent intent into verified
            financial execution across payment and non-payment actions.
          </p>
          <p>
            That work sits primarily in layers two and three: runtime
            orchestration and domain execution. It encompasses the agent loop,
            tools, sessions, persistence, and multistep state; translates intent
            into typed actions and transactions; simulates expected outcomes;
            and prepares a concrete request for an external signer.
            <Cite n="7" />
            <Cite n="8" />
            Wallets, identity providers, compliance systems, payment protocols,
            stablecoins, and settlement rails remain integrated components, not
            the category our work claims.
          </p>
          <h3>8.1 Where our work sits</h3>
          <div className={styles.posMap}>
            <div className={styles.posAxis}>
              Broad agent and commerce scope ▲
            </div>
            <MapNodes of={aomiMapAbove} from={0} />
            <div className={styles.posAomi}>
              <b>Aomi Labs</b>
              <span>execution infrastructure research</span>
            </div>
            <MapNodes of={aomiMapBelow} from={0} />
            <div className={styles.posAxis}>
              ▼ Financial and onchain specific
            </div>
          </div>
          <div className={styles.posFoot}>
            <span>Intent and planning</span>
            <span>───────▶</span>
            <span>Authority and settlement</span>
          </div>
          <div className={styles.posPartners}>
            <b>Required partners · horizontal</b>
            <span>
              Compliance · security · threat detection · observability
            </span>
          </div>
          <h3>8.2 What the thesis does not claim</h3>
          <p>
            We are not proposing a new wallet, stablecoin, payment protocol,
            facilitator, card network, or settlement chain. “Policy layer” and
            “transaction firewall” are also too narrow: policy and guards are
            subsystems inside a broader runtime. The research concerns a
            generalized execution surface — pay, swap, bridge, lend, stake,
            trade, deploy, call APIs, and reconcile outcomes.
          </p>
          <Figure
            number="7"
            title="The execution responsibility boundary"
            caption={
              <>
                The runtime coordinates execution and evidence. The wallet
                retains authority and the power to refuse; funding systems
                supply value; rails provide finality.
              </>
            }
          >
            <div className={styles.aomiBoundary}>
              <div>
                <span>Demand</span>
                <b>Intent</b>
                <p>Goal, budget, timing, constraints, desired result</p>
              </div>
              <i>→</i>
              <div className={styles.aomiCore}>
                <AomiLogo
                  className={styles.figureLogo}
                  markClassName={styles.figureMark}
                />
                <b>Execution runtime</b>
                <p>plan · tools · construct · simulate · execute · reconcile</p>
              </div>
              <i>→</i>
              <div>
                <span>Authority</span>
                <b>Wallet and mandate</b>
                <p>identity, consent, limits, risk, refusal</p>
              </div>
              <i>→</i>
              <div>
                <span>Finality</span>
                <b>Money and rails</b>
                <p>stablecoins, cards, banks, chains</p>
              </div>
            </div>
          </Figure>
          <h3>8.3 Strategic whitespace implied by the research</h3>
          <ol className={styles.priorities}>
            <li>
              <b>Protocol-aware execution quality.</b> Typed calls, protocol
              constraints, fork simulation, balance deltas, and outcome
              assertions should create measurable leverage over generic tool
              use.
            </li>
            <li>
              <b>A portable runtime above wallet fragmentation.</b> Support
              self-custodial, embedded, and institutional wallets rather than
              betting the runtime on one custody model.
            </li>
            <li>
              <b>Payment-protocol neutrality.</b> Treat x402, MPP, cards, and
              direct stablecoin transfer as tools selected by app and mandate.
            </li>
            <li>
              <b>Evidence as a product.</b> Record user intent, tool calls,
              immutable payload, simulation, policy decisions, signer, receipt,
              and final state as one inspectable chain.
            </li>
            <li>
              <b>Partner-owned distribution.</b> Wallets, protocols, exchanges,
              fintechs, and partner apps keep the user relationship while our
              infrastructure supports execution.
            </li>
            <li>
              <b>Benchmark the runtime.</b> Measure task completion,
              dangerous-proposal block rate, simulation-to-execution
              consistency, duplicate-broadcast rate, human escalation, and
              end-state correctness.
            </li>
          </ol>
          <h3>8.4 Competitive threats</h3>
          <p>
            Four vectors converge on layers two and three. Wallets can move
            upward: Coinbase, MetaMask, OKX, Circle, Privy, and Turnkey can all
            add tools and construction above the signing boundary they already
            own. Payment platforms can move inward: Stripe and Crossmint can add
            orchestration around money movement. Vertical execution providers —
            Bankr, 1inch, deBridge, Uniswap, and the exchanges — may own
            high-frequency domains outright. And general agent frameworks can
            move downward, adding wallets and payment plugins to existing
            distribution. The Aomi Labs thesis therefore depends on specialized
            infrastructure being materially better at generalized, verified
            onchain execution than a wallet assistant or a protocol-specific
            skill.
          </p>
          <div className={styles.disclosure}>
            <b>Researcher disclosure</b>
            <p>
              Aomi Labs researches and develops infrastructure in the category
              analyzed here. This section presents our institutional thesis, not
              an independent market conclusion. External observations and vendor
              claims are cited; the proposed benchmark is a falsifiable test, not
              an already measured result.
            </p>
          </div>
        </Section>

        <Section
          number="9"
          title="Risks, outlook, and conclusion"
          id="conclusion"
        >
          <h3>9.1 Unresolved risks</h3>
          <p>
            The open problems are not evenly distributed across the stack, and
            few of them are solved by any single layer.
          </p>
          <div className={styles.metrics}>
            {risks.map(([name, description]) => (
              <div key={name}>
                <b>{name}</b>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <p>
            Liability deserves separate emphasis because it cuts across all of
            them. It remains fragmented across user, model provider, runtime,
            tool, wallet, facilitator, merchant, issuer, and settlement rail,
            and regulatory classification can change with custody, payment
            initiation, brokerage, advice, sanctions exposure, or jurisdiction.
            A technically successful design may still fail if no participant
            clearly owns refunds, disputes, exceptions, and loss.
          </p>
          <h3>9.2 Outlook</h3>
          <p>
            Over the next twelve months, wallets are likely to make
            agent-specific policies, escalation, and transaction security
            default features. x402 and MPP will compete for paid APIs while
            processors support both. ACP, UCP, and AP2 integrations will expand
            across merchant systems, and stablecoin issuers will bundle wallets,
            discovery, compliance, and nanopayments. DeFi agents will remain
            valuable but risk-tolerant early adopters. Independent security and
            observability will become enterprise requirements.
          </p>
          <p>
            Over a two-to-three-year horizon, agents should carry portable
            mandates and credentials across surfaces; service marketplaces
            should expose machine-readable price, capability, reputation, and
            delivery guarantees; cross-rail routers should choose among
            stablecoin, card, bank, and local rails automatically; and agent
            treasury and accounting should become standard enterprise
            infrastructure. Durable systems will separate proposer, executor,
            authorizer, and settler while linking all four through evidence. At
            that point “agentic payments” stops being a category and becomes a
            capability embedded in runtimes, wallets, commerce platforms, and
            financial software.
          </p>
          <h3>9.3 A decision checklist for any player</h3>
          <p>
            The taxonomy in this paper is only useful if it can place a real
            company quickly. Ten questions do most of that work, and the last
            two are usually the most revealing.
          </p>
          <ol className={styles.priorities}>
            {checklist.map(([question, answer]) => (
              <li key={question}>
                <b>{question}</b> {answer}.
              </li>
            ))}
          </ol>
          <h3>9.4 Conclusion</h3>
          <p className={styles.conclusion}>
            Agentic payments will not mature simply because models receive
            wallets. They will mature when software can form an adaptive intent,
            turn it into a valid and inspectable action, operate within
            delegated authority, settle through the appropriate rail, and prove
            that the requested outcome occurred. Better models will become
            better athletes. Execution harnesses are the vehicles that let the
            same athlete travel farther, faster, and with evidence.
          </p>
        </Section>

        <section className={styles.references}>
          <div className={styles.sectionRule}>
            <span>References</span>
          </div>
          <h2>References</h2>
          <ol>
            {references.map(([n, author, title, href]) => (
              <li id={`ref-${n}`} key={n}>
                <span>{n}.</span>
                <p>
                  <b>{author}.</b>{" "}
                  <a href={href} target="_blank" rel="noreferrer">
                    {title}
                  </a>
                  . Accessed August 2026.
                </p>
              </li>
            ))}
          </ol>
        </section>

        <footer className={styles.footer}>
          <AomiLogo
            className={styles.footerLogo}
            markClassName={styles.footerMark}
          />
          <p>Aomi Labs Research · August 2026</p>
          <Link to="/research">All research</Link>
        </footer>
      </article>
    </main>
  );
}
