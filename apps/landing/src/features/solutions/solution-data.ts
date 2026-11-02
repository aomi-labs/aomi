export type SolutionId = "fintech" | "defi" | "trading" | "nft" | "wallets";

export type DemoOption = {
  id: string;
  label: string;
  prompt: string;
  title: string;
  detail: string;
  metrics: readonly { label: string; value: string }[];
  checks: readonly string[];
};

export type SolutionConfig = {
  id: SolutionId;
  eyebrow: string;
  headline: string;
  lede: string;
  audience: string;
  accent: string;
  tint: string;
  proof: readonly string[];
  demoName: string;
  demoContext: string;
  demoOptions: readonly DemoOption[];
  valueEyebrow: string;
  valueTitle: string;
  valueIntro: string;
  needs: readonly { title: string; body: string }[];
  flowTitle: string;
  flowIntro: string;
  flow: readonly { label: string; title: string; body: string }[];
  paths: readonly {
    name: string;
    badge: string;
    title: string;
    body: string;
    href: string;
  }[];
  finalTitle: string;
  finalBody: string;
};

export const fintechSolution: SolutionConfig = {
  id: "fintech",
  eyebrow: "AOMI FOR FINTECH",
  headline: "Put tokenized assets to work through a governed execution desk.",
  lede: "Launch governed treasury, vault, and RWA workflows inside the product your customers already trust. Aomi turns policy-bound intent into simulated, signable transactions.",
  audience:
    "For asset managers, treasury platforms, tokenized funds, and fintech teams",
  accent: "#5f34e8",
  tint: "#f2edff",
  proof: [
    "Policy before execution",
    "Existing custody stays",
    "Auditable Actions",
  ],
  demoName: "Treasury mandate",
  demoContext: "$2.4M USDC · Base",
  demoOptions: [
    {
      id: "liquidity",
      label: "Preserve liquidity",
      prompt: "Keep 40% liquid and put the rest into approved tokenized yield.",
      title: "Allocate under the treasury mandate",
      detail: "40% liquid reserve · 60% tokenized T-bill allocation",
      metrics: [
        { label: "Projected yield", value: "4.72%" },
        { label: "Liquidity", value: "T+0 / T+1" },
        { label: "Policy checks", value: "6 passed" },
      ],
      checks: ["Issuer allowlist", "40% liquidity floor", "Single-venue cap"],
    },
    {
      id: "income",
      label: "Maximize income",
      prompt:
        "Find the best approved net yield without exceeding a 35% venue cap.",
      title: "Route across three approved venues",
      detail: "Weighted allocation · fees and redemption windows included",
      metrics: [
        { label: "Projected yield", value: "5.08%" },
        { label: "Venues", value: "3 approved" },
        { label: "Policy checks", value: "8 passed" },
      ],
      checks: ["35% venue cap", "Daily liquidity", "Issuer concentration"],
    },
  ],
  valueEyebrow: "WHAT FINTECH BUYERS NEED",
  valueTitle: "Automation that fits the operating model.",
  valueIntro:
    "The opportunity is not another crypto dashboard. It is faster asset operations without giving up the controls, custody, and evidence expected of financial software.",
  needs: [
    {
      title: "Governance is part of the product",
      body: "Encode issuer allowlists, concentration limits, liquidity floors, and approval roles before a transaction is shown for signature.",
    },
    {
      title: "Integrate with the existing stack",
      body: "Keep the customer record, custody model, reporting, and signer already in place. Add Aomi only at the intent-to-execution boundary.",
    },
    {
      title: "Reconcile every state change",
      body: "A durable Action links the original mandate, simulation, exact payload, signer response, and verified onchain result.",
    },
  ],
  flowTitle: "From mandate to reconciled position.",
  flowIntro:
    "Every automated operation passes through the same explicit control points.",
  flow: [
    {
      label: "01",
      title: "Express",
      body: "Submit a treasury instruction, vault mandate, or asset lifecycle task.",
    },
    {
      label: "02",
      title: "Constrain",
      body: "Apply application policy, account permissions, and portfolio limits.",
    },
    {
      label: "03",
      title: "Simulate",
      body: "Price and fork-simulate the complete batch before approval.",
    },
    {
      label: "04",
      title: "Reconcile",
      body: "Verify settlement and return a receipt your operations layer can consume.",
    },
  ],
  paths: [
    {
      name: "Widget",
      badge: "WHITE LABEL",
      title: "Put operations inside your product",
      body: "Give customers a branded mandate and approval surface above your existing wallet or custodian.",
      href: "/products/widget",
    },
    {
      name: "Agent API",
      badge: "V1",
      title: "Let Aomi resolve the intent",
      body: "Send the instruction and wallet capabilities; receive messages and a durable Action for approval.",
      href: "/products/rest-apis",
    },
    {
      name: "Pipeline API",
      badge: "PREVIEW",
      title: "Keep your own decision engine",
      body: "Feed selected actions into Aomi for guarded construction, simulation, and signing handoff.",
      href: "/products/rest-apis",
    },
  ],
  finalTitle: "Launch the workflow, not another dashboard.",
  finalBody:
    "Bring one real mandate. We will map its policy, signer, execution, and receipt boundaries with your team.",
};

export const defiSolution: SolutionConfig = {
  id: "defi",
  eyebrow: "AOMI FOR DEFI",
  headline: "Turn protocol complexity into one clear action.",
  lede: "Help users discover, compare, and execute DeFi opportunities without making them reason through routes, approvals, bridges, and contract calls on their own.",
  audience: "For protocols, aggregators, exchanges, and DeFi frontends",
  accent: "#087f65",
  tint: "#eaf8f3",
  proof: ["Net outcome compared", "Full batch simulated", "User signs once"],
  demoName: "Protocol execution",
  demoContext: "10,000 USDC · Ethereum",
  demoOptions: [
    {
      id: "earn",
      label: "Earn",
      prompt: "Find the best approved USDC yield after gas and incentives.",
      title: "Supply to Aave v3",
      detail: "Best 30-day net outcome · no bridge required",
      metrics: [
        { label: "Net APY", value: "4.18%" },
        { label: "Liquidity", value: "$412M" },
        { label: "Risk band", value: "A" },
      ],
      checks: ["Protocol allowlist", "Oracle healthy", "Deposits open"],
    },
    {
      id: "swap",
      label: "Swap",
      prompt: "Swap 10,000 USDC to ETH with no more than 20 bps impact.",
      title: "Split across two liquidity sources",
      detail: "Uniswap v3 + Curve · minimum received enforced",
      metrics: [
        { label: "ETH received", value: "3.984" },
        { label: "Price impact", value: "8 bps" },
        { label: "Gas estimate", value: "$4.82" },
      ],
      checks: ["20 bps limit", "Token verified", "Atomic route"],
    },
  ],
  valueEyebrow: "WHAT DEFI USERS NEED",
  valueTitle: "Better outcomes with legible risk.",
  valueIntro:
    "DeFi users will accept automation when it makes the decision easier to inspect—not when it hides protocol, liquidity, approval, or execution risk.",
  needs: [
    {
      title: "Compare the net outcome",
      body: "Rank opportunities after gas, incentives, liquidity, lockups, and bridge costs instead of advertising a headline rate.",
    },
    {
      title: "Make safety visible",
      body: "Show protocols, checks, warnings, and exact transaction consequences before the user reaches the signer.",
    },
    {
      title: "Reduce transaction choreography",
      body: "Collapse approvals, swaps, deposits, and bridging into one simulated batch with one coherent confirmation.",
    },
  ],
  flowTitle: "From intent to protocol receipt.",
  flowIntro:
    "The user sees the outcome; Aomi handles the transaction choreography underneath.",
  flow: [
    {
      label: "01",
      title: "Discover",
      body: "Resolve an intent against current protocol and market context.",
    },
    {
      label: "02",
      title: "Compare",
      body: "Normalize net outcomes, liquidity, fees, and application risk bands.",
    },
    {
      label: "03",
      title: "Simulate",
      body: "Build and fork-simulate every approval and protocol call as one batch.",
    },
    {
      label: "04",
      title: "Confirm",
      body: "Present one Action to the existing signer and verify the final position.",
    },
  ],
  paths: [
    {
      name: "Widget",
      badge: "EMBED",
      title: "Add intent to your frontend",
      body: "Keep users in your product while Aomi supplies discovery, execution context, and approval UI.",
      href: "/products/widget",
    },
    {
      name: "Agent API",
      badge: "V1",
      title: "Ship a protocol-aware agent",
      body: "Let Aomi interpret open-ended user goals and return an inspectable Action.",
      href: "/products/rest-apis",
    },
    {
      name: "Plugin SDK",
      badge: "RUST",
      title: "Teach Aomi your protocol",
      body: "Package protocol reads and transaction builders as a hosted application in the shared runtime.",
      href: "/products/plugin-sdk",
    },
  ],
  finalTitle: "Make the protocol easy without making it opaque.",
  finalBody:
    "Start with one high-value flow—earn, swap, borrow, bridge, or rebalance—and keep every decision visible.",
};

export const tradingSolution: SolutionConfig = {
  id: "trading",
  eyebrow: "AOMI FOR TRADING",
  headline: "Your strategy. Guarded execution across every venue.",
  lede: "Give traders and agents a reliable execution layer that can compare liquidity, enforce exposure, simulate the route, and return an exact order for approval.",
  audience: "For trading desks, strategy teams, brokers, and agent builders",
  accent: "#2858e8",
  tint: "#edf2ff",
  proof: ["Exposure bounded", "Venue-aware routing", "Exactly-once resume"],
  demoName: "Execution desk",
  demoContext: "$500K limit · ETH",
  demoOptions: [
    {
      id: "position",
      label: "Build position",
      prompt:
        "Buy 120 ETH without exceeding 15 bps impact or 40% venue exposure.",
      title: "Route a bounded TWAP across three venues",
      detail: "12 slices · 18 minutes · price and exposure limits attached",
      metrics: [
        { label: "Est. average", value: "$3,108" },
        { label: "Price impact", value: "9 bps" },
        { label: "Venues", value: "3" },
      ],
      checks: ["$500K exposure", "15 bps impact", "40% venue cap"],
    },
    {
      id: "hedge",
      label: "Hedge risk",
      prompt:
        "Hedge half of the ETH delta while keeping funding below 8% annualized.",
      title: "Open a bounded short hedge",
      detail: "Perpetual route · 50% delta target · reduce-only unwind",
      metrics: [
        { label: "Hedge size", value: "60 ETH" },
        { label: "Funding", value: "5.4%" },
        { label: "Margin", value: "2.1×" },
      ],
      checks: ["Funding ceiling", "Leverage limit", "Liquidation buffer"],
    },
  ],
  valueEyebrow: "WHAT TRADERS NEED",
  valueTitle: "Execution quality with hard boundaries.",
  valueIntro:
    "Traders do not need an agent that sounds confident. They need reliable routing, explicit risk limits, recoverable state, and evidence that the order matched the mandate.",
  needs: [
    {
      title: "Price, liquidity, and cost together",
      body: "Select routes using market depth, slippage, fees, funding, and fill probability—not a single quoted price.",
    },
    {
      title: "Risk limits before the order",
      body: "Attach exposure, leverage, venue, impact, and loss constraints to the Action that reaches the signer.",
    },
    {
      title: "Automation that can recover",
      body: "Persist execution state, make retries idempotent, and resume safely after partial fills or external signing.",
    },
  ],
  flowTitle: "From strategy signal to verified fill.",
  flowIntro:
    "Keep judgment in your strategy while Aomi owns the guarded execution boundary.",
  flow: [
    {
      label: "01",
      title: "Signal",
      body: "Your trader or agent specifies the desired position and constraints.",
    },
    {
      label: "02",
      title: "Route",
      body: "Compare supported venues using current liquidity and execution cost.",
    },
    {
      label: "03",
      title: "Guard",
      body: "Reject any plan that breaches exposure, leverage, or price policy.",
    },
    {
      label: "04",
      title: "Verify",
      body: "Match resulting fills against the sealed order before resuming the strategy.",
    },
  ],
  paths: [
    {
      name: "Pipeline API",
      badge: "PREVIEW",
      title: "Bring your own strategy",
      body: "Submit the selected action and constraints; receive a guarded signable with no Aomi inference.",
      href: "/products/rest-apis",
    },
    {
      name: "Agent API",
      badge: "V1",
      title: "Delegate portfolio intent",
      body: "Let an outer agent orchestrate Aomi specialists while keeping the final Action explicit.",
      href: "/products/rest-apis",
    },
    {
      name: "Agentic Toolings",
      badge: "MCP + CLI",
      title: "Operate from the desk",
      body: "Give coding agents and operators the same execution harness through Skills, MCP, or CLI.",
      href: "/products/agentic-toolings",
    },
  ],
  finalTitle: "Put a deterministic boundary around every strategy.",
  finalBody:
    "Bring one venue, one signal, and one risk policy. We will turn them into a recoverable execution path.",
};

export const nftSolution: SolutionConfig = {
  id: "nft",
  eyebrow: "AOMI FOR NFT MARKETPLACES",
  headline: "Make collecting feel like commerce—not contract calls.",
  lede: "Give collectors a conversational path from discovery to a verified listing, transparent cost, and safe purchase—without a maze of wallets and marketplace screens.",
  audience:
    "For marketplaces, collections, creator platforms, and consumer brands",
  accent: "#d94d76",
  tint: "#fff0f4",
  proof: ["Collection verified", "Total cost shown", "Exact item approved"],
  demoName: "Collection concierge",
  demoContext: "Verified collection · Ethereum",
  demoOptions: [
    {
      id: "collect",
      label: "Collect",
      prompt:
        "Find a verified piece under 0.8 ETH with a rare background trait.",
      title: "Acquire item #8421 for 0.72 ETH",
      detail: "Verified contract · seller held 214 days · metadata pinned",
      metrics: [
        { label: "Total cost", value: "0.729 ETH" },
        { label: "Floor delta", value: "+3.1%" },
        { label: "Trait rarity", value: "4.8%" },
      ],
      checks: ["Contract verified", "Approval scoped", "Listing active"],
    },
    {
      id: "list",
      label: "List",
      prompt:
        "List my piece near the trait floor, but do not accept below 0.9 ETH.",
      title: "Create a 7-day bounded listing",
      detail: "1.04 ETH ask · 0.9 ETH protected floor · royalty disclosed",
      metrics: [
        { label: "Ask", value: "1.04 ETH" },
        { label: "Royalty", value: "2.5%" },
        { label: "Duration", value: "7 days" },
      ],
      checks: ["Token ownership", "Floor protected", "Operator scoped"],
    },
  ],
  valueEyebrow: "WHAT COLLECTORS NEED",
  valueTitle: "Trust and simplicity for every motivation.",
  valueIntro:
    "Collectors arrive for utility, community, potential upside, or the work itself. The common requirement is a trusted marketplace and a purchase flow they can understand.",
  needs: [
    {
      title: "Discovery with context",
      body: "Translate natural-language taste, budget, utility, and trait preferences into a small set of relevant items.",
    },
    {
      title: "Trust before urgency",
      body: "Verify the collection, seller, listing, metadata, approvals, royalties, and warnings before presenting the buy action.",
    },
    {
      title: "One transparent checkout",
      body: "Show item, network, marketplace fee, royalty, gas, and total cost in one confirmation handled by the existing wallet.",
    },
  ],
  flowTitle: "From conversation to verified ownership.",
  flowIntro:
    "Use the agent for discovery; use the execution kernel for certainty.",
  flow: [
    {
      label: "01",
      title: "Discover",
      body: "Resolve taste, utility, collection, trait, and budget constraints.",
    },
    {
      label: "02",
      title: "Verify",
      body: "Check contract identity, live ownership, listing status, and metadata integrity.",
    },
    {
      label: "03",
      title: "Preview",
      body: "Present the exact item and complete cost before requesting approval.",
    },
    {
      label: "04",
      title: "Acquire",
      body: "Sign through the existing wallet and verify ownership after settlement.",
    },
  ],
  paths: [
    {
      name: "Widget",
      badge: "EMBED",
      title: "Add a collection concierge",
      body: "Place discovery and checkout directly inside the marketplace or collection experience.",
      href: "/products/widget",
    },
    {
      name: "Plugin SDK",
      badge: "RUST",
      title: "Encode marketplace knowledge",
      body: "Package catalog search, listing validation, and transaction builders as a hosted Aomi App.",
      href: "/products/plugin-sdk",
    },
    {
      name: "Agent API",
      badge: "V1",
      title: "Power one-shot buying agents",
      body: "Let users express the outcome while your marketplace controls inventory, policy, and signing.",
      href: "/products/rest-apis",
    },
  ],
  finalTitle: "Turn marketplace inventory into a guided experience.",
  finalBody:
    "Start with one collection and one transaction type. Make discovery useful and checkout unambiguous.",
};

export const walletsSolution: SolutionConfig = {
  id: "wallets",
  eyebrow: "AOMI FOR WALLETS",
  headline: "Give every wallet an execution layer.",
  lede: "Add intent-driven swaps, transfers, bridging, yield, and application actions above the authentication and signer your users already trust. Keys never move to Aomi.",
  audience:
    "For self-custody wallets, embedded-wallet providers, and retail fintech",
  accent: "#14785f",
  tint: "#ebf8f3",
  proof: ["Your signer remains", "Exact payload preview", "No Aomi custody"],
  demoName: "Wallet assistant",
  demoContext: "0xA7…4C · Base",
  demoOptions: [
    {
      id: "swap",
      label: "Swap",
      prompt: "Swap 0.5 ETH to USDC, but stop if I receive less than $1,220.",
      title: "Swap through Uniswap v3",
      detail: "0.5 ETH out · minimum 1,220 USDC in · Base",
      metrics: [
        { label: "Expected", value: "1,241 USDC" },
        { label: "Price impact", value: "5 bps" },
        { label: "Network fee", value: "$0.06" },
      ],
      checks: ["Minimum enforced", "Token verified", "One-time approval"],
    },
    {
      id: "earn",
      label: "Earn",
      prompt: "Put 2,000 idle USDC into approved yield without bridging.",
      title: "Supply 2,000 USDC to Aave v3",
      detail: "Base · withdraw anytime · no new token approval required",
      metrics: [
        { label: "Net APY", value: "4.11%" },
        { label: "Liquidity", value: "$98M" },
        { label: "Risk band", value: "A" },
      ],
      checks: ["Protocol approved", "Same network", "Simulation passed"],
    },
  ],
  valueEyebrow: "WHAT WALLET USERS NEED",
  valueTitle: "More capability without more anxiety.",
  valueIntro:
    "Security and ease of use determine wallet choice. An agent must make complex actions simpler while preserving the signer, preview, and user’s ability to say no.",
  needs: [
    {
      title: "Keep control recognizable",
      body: "Use the wallet’s current account, chain selector, authentication, and signature prompt. Never introduce a shadow custody model.",
    },
    {
      title: "Explain what will change",
      body: "Show assets out, assets in, destination, approvals, fees, slippage, warnings, and the exact application involved.",
    },
    {
      title: "Make advanced actions approachable",
      body: "Let a user ask for the outcome while Aomi handles routes and protocol choreography behind one review surface.",
    },
  ],
  flowTitle: "From a sentence to the wallet’s signer.",
  flowIntro:
    "Aomi expands what the wallet can do without replacing what makes the wallet trusted.",
  flow: [
    {
      label: "01",
      title: "Ask",
      body: "The user states an outcome in the wallet’s own branded surface.",
    },
    {
      label: "02",
      title: "Resolve",
      body: "Aomi discovers routes and builds a policy-compliant transaction batch.",
    },
    {
      label: "03",
      title: "Review",
      body: "The wallet displays one sealed Action with consequences and warnings.",
    },
    {
      label: "04",
      title: "Sign",
      body: "The existing signer approves; Aomi verifies the resulting onchain state.",
    },
  ],
  paths: [
    {
      name: "Widget",
      badge: "WHITE LABEL",
      title: "Ship the complete surface",
      body: "Mount the chat, trace, Action review, and wallet handoff while retaining your branding.",
      href: "/products/widget",
    },
    {
      name: "Agent API",
      badge: "V1",
      title: "Render your own interface",
      body: "Consume messages and Actions while your wallet owns navigation, accounts, and approvals.",
      href: "/products/rest-apis",
    },
    {
      name: "Client adapters",
      badge: "TYPESCRIPT",
      title: "Bind the signer once",
      body: "Connect wagmi, Para, Privy, Safe, or Turnkey through one execution boundary.",
      href: "/products/rest-apis",
    },
  ],
  finalTitle: "Add the agent. Keep the wallet yours.",
  finalBody:
    "We will map Aomi onto your existing auth, account, chain, signer, and transaction-review model.",
};

export const solutionPages = {
  fintech: fintechSolution,
  defi: defiSolution,
  trading: tradingSolution,
  nft: nftSolution,
  wallets: walletsSolution,
} as const satisfies Record<SolutionId, SolutionConfig>;
