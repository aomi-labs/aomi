export type ResearchPost = {
  slug: string;
  title: string;
  date: string;
  isoDate: string;
  tag: string;
  subtitle: string;
  fileName?: string;
  format?: "markdown" | "execution-harnesses" | "three-gates";
};

export const researchPosts: ResearchPost[] = [
  {
    slug: "three-gates-onchain",
    title: "Enabling Agentic Finance: Three Gates from Intent to Settlement",
    date: "September 18, 2026",
    isoDate: "2026-09-18",
    tag: "research",
    subtitle:
      "How the runtime, wallet, smart contract and block builder can constrain agent-built transactions.",
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
    fileName: "aomibench-v0.1.md",
    format: "markdown",
  },
];

export function getResearchPost(slug: string) {
  return researchPosts.find((post) => post.slug === slug) ?? null;
}

