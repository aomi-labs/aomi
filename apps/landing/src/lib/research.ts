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
  // Posts served at /blog/<slug>. Earlier blog posts keep their /research URLs.
  base?: "blog";
  fileName?: string;
  format?: "markdown" | "execution-harnesses" | "three-gates";
};

// Single source of truth for published writing, newest first.
export const posts: ResearchPost[] = [
  {
    slug: "agentic-fuzzer",
    title:
      "Announcing Agentic Fuzzer: Stateful attacks on protocol states with frontier models",
    date: "October 26, 2026",
    isoDate: "2026-10-26",
    tag: "launch",
    subtitle:
      "Agentic fuzzing for Arc Studio apps, now in preview: the AI agent writes the threat model and the attack, and a deterministic engine on a held Arc fork decides what counts as a finding.",
    cover: "/blog/agentic-fuzzer/figures/cover.png",
    readMinutes: 10,
    research: false,
    base: "blog",
    fileName: "introducing-the-agentic-fuzzer.md",
    format: "markdown",
  },
  {
    slug: "introducing-the-aomi-task-api",
    title:
      "Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc",
    date: "October 13, 2026",
    isoDate: "2026-10-13",
    tag: "launch",
    subtitle:
      "Prepare an intent for 0.01 USDC, inspect a signed simulation preview, and retrieve an unsigned bundle for 3% of simulated outgoing USDC.",
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
export const blogPosts = posts.filter((post) => post.base === "blog");

export function postHref(post: ResearchPost) {
  return post.base === "blog" ? `/blog/${post.slug}` : `/research/${post.slug}`;
}

/** Router link props for a post: blog posts live at /blog, the rest at /research. */
export function postLink(post: ResearchPost) {
  return {
    to: post.base === "blog" ? "/blog/$slug" : "/research/$slug",
    params: { slug: post.slug },
  } as const;
}

export function getResearchPost(slug: string) {
  return posts.find((post) => post.slug === slug) ?? null;
}

