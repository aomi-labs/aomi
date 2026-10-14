export type ResearchPost = {
  slug: string;
  title: string;
  date: string;
  isoDate: string;
  tag: string;
  subtitle: string;
  cover: string;
  readMinutes: number;
  // Every post appears on /blog. Only posts with lasting reference value
  // (papers, benchmarks) are also shelved on /research.
  research: boolean;
  fileName?: string;
  format?: "markdown" | "execution-harnesses" | "three-gates";
};

// Single source of truth for published writing, newest first.
export const posts: ResearchPost[] = [
  {
    slug: "introducing-the-aomi-task-api",
    title:
      "Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc",
    date: "October 13, 2026",
    isoDate: "2026-10-13",
    tag: "launch",
    subtitle:
      "A wallet-signed task becomes a simulation-verified outcome that another agent can inspect, purchase in USDC, and execute with its own Circle wallet.",
    cover: "/research/introducing-the-aomi-task-api/figures/architecture.png",
    readMinutes: 9,
    research: false,
    fileName: "introducing-the-aomi-task-api.md",
    format: "markdown",
  },
  {
    slug: "three-gates-onchain",
    title: "Enabling Agentic Finance: Three Gates from Intent to Settlement",
    date: "September 18, 2026",
    isoDate: "2026-09-18",
    tag: "research",
    subtitle:
      "How the runtime, wallet, smart contract and block builder can constrain agent-built transactions.",
    cover: "/assets/covers/three-gates-poster.jpg",
    readMinutes: 14,
    research: true,
    fileName: "three-gates-onchain.md",
    format: "three-gates",
  },
  {
    slug: "execution-harnesses-agentic-payments",
    title: "The State of Execution Harnesses for Agentic Payments",
    date: "August 13, 2026",
    isoDate: "2026-08-13",
    tag: "research",
    subtitle:
      "Breaking down the seven-layer agentic payments stack and identifying the missing execution harness that makes financial agents efficient, reliable, and operational.",
    cover: "/assets/covers/why-a-harness.jpg",
    readMinutes: 12,
    research: true,
    format: "execution-harnesses",
  },
  {
    slug: "auth-across-two-worlds",
    title:
      "One User, Many Wallets: Authentication Across the Onchain–Offchain Boundary",
    date: "July 13, 2026",
    isoDate: "2026-07-13",
    tag: "engineering",
    subtitle:
      "A design study in hybrid crypto authentication: why counting users is hard onchain, the four proofs to keep separate, and the patterns — and stack — that hold them apart.",
    cover: "/assets/covers/one-user-four-proofs.jpg",
    readMinutes: 9,
    research: false,
    fileName: "auth-across-two-worlds.md",
    format: "markdown",
  },
  {
    slug: "aomibench-v0-1",
    title: "AomiBench: Benchmarking Frontier Models on Onchain Execution",
    date: "June 4, 2026",
    isoDate: "2026-06-04",
    tag: "benchmark",
    subtitle:
      "A wallet-aware harness for measuring frontier agents on real onchain tasks, simulations, and chain-state evidence.",
    cover: "/assets/covers/score-the-transaction.jpg",
    readMinutes: 7,
    research: true,
    fileName: "aomibench-v0.1.md",
    format: "markdown",
  },
];

export const researchPosts = posts.filter((post) => post.research);

export function getResearchPost(slug: string) {
  return posts.find((post) => post.slug === slug) ?? null;
}

