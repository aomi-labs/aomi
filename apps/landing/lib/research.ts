import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

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
    slug: "introducing-the-agentic-fuzzer",
    title:
      "Announcing Agentic Fuzzer: Stateful attacks on protocol states with frontier models",
    date: "October 26, 2026",
    isoDate: "2026-10-26",
    tag: "launch",
    subtitle:
      "Agentic fuzzing for Arc Studio apps, now in preview: the AI agent writes the threat model and the attack, and a deterministic engine on a held Arc fork decides what counts as a finding.",
    cover: "/research/introducing-the-agentic-fuzzer/figures/cover.png",
    readMinutes: 10,
    research: false,
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

export function getResearchPost(slug: string) {
  return posts.find((post) => post.slug === slug) ?? null;
}

function renderPendingFigureComments(body: string) {
  return body.replace(
    /<!--\s*Figure\s+(\d+)(?:\s*\([^)]*\))?\s+—\s+([\s\S]*?)\.\s+Not yet built\.\s*-->/g,
    (_match, number: string, title: string) => {
      const cleanTitle = title.replace(/\s*\(←[^)]*\)/g, "").trim();

      return `\n\n> **Figure ${number} — ${cleanTitle}**\n> Chart pending.\n\n`;
    },
  );
}

function renderMissingFigureImages(body: string) {
  return body.replace(
    /!\[([^\]]+)\]\(figures\/([^)]+)\)/g,
    (match, alt: string, fileName: string) => {
      const asset = path.join(
        process.cwd(),
        "public",
        "research",
        "aomibench-v0.1",
        "figures",
        fileName,
      );

      if (existsSync(asset)) {
        return match;
      }

      const title = alt.split(".")[0]?.trim() || `Figure asset ${fileName}`;

      return `\n\n> **${title}**\n> Figure asset pending: \`${fileName}\`.\n\n`;
    },
  );
}

function prepareResearchMarkdown(body: string, slug: string) {
  const prepared =
    slug === "aomibench-v0-1"
      ? renderMissingFigureImages(renderPendingFigureComments(body))
      : body;

  return prepared
    .replace(/^<!--[\s\S]*?-->\s*/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

export async function readResearchPost(slug: string) {
  const post = getResearchPost(slug);

  if (post === null) {
    return null;
  }

  if (post.fileName === undefined) {
    return {
      ...post,
      body: "",
    };
  }

  const file = path.join(process.cwd(), "content", "research", post.fileName);
  const body = await fs.readFile(file, "utf8");

  return {
    ...post,
    body: prepareResearchMarkdown(body, slug),
  };
}
