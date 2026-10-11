export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  isoDate: string;
  tag: string;
  excerpt: string;
  cover: string;
  readMinutes: number;
  href: string;
};

// Newest first. The first entry renders as the featured post on /blog.
export const blogPosts: BlogPost[] = [
  {
    slug: "one-user-many-wallets",
    title: "One User, Many Wallets",
    date: "July 13, 2026",
    isoDate: "2026-07-13",
    tag: "Engineering",
    excerpt:
      "Why counting users is hard onchain, the four proofs an account must keep separate, and the stack that holds them apart.",
    cover: "/covers/pastel-thought.webp",
    readMinutes: 9,
    href: "/research/auth-across-two-worlds",
  },
  {
    slug: "aomibench-v0-1",
    title: "AomiBench v0.1: frontier models on real onchain tasks",
    date: "June 4, 2026",
    isoDate: "2026-06-04",
    tag: "Benchmark",
    excerpt:
      "A wallet-aware harness that scores agents on executed transactions and chain-state evidence, not plausible text.",
    cover: "/covers/pastel-desk.webp",
    readMinutes: 7,
    href: "/research/aomibench-v0-1",
  },
];
