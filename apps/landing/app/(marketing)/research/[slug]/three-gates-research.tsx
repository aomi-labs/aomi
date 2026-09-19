import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ResearchPost } from "@/lib/research";
import styles from "./three-gates-research.module.css";

type Props = { post: ResearchPost & { body: string } };

const sections = [
  ["intent-build-sign-settle", "Intent → build → sign → settle"],
  ["the-risk-landscape-attacks-vs-defects", "The risk landscape: attacks vs defects"],
  ["where-the-gates-sit", "Where the gates sit"],
  ["gate-0-5-guardrails-during-building", "0.5 / Guardrails during building"],
  ["gate-1-the-wallet-that-can-refuse-to-sign", "1 / The wallet that can refuse to sign"],
  ["gate-2-mandates-enforced-onchain", "2 / Mandates enforced onchain"],
  ["gate-3-assertions-at-the-builder-boundary", "3 / Assertions at the builder boundary"],
  ["designing-the-composite-not-collecting-logos", "Designing the composite"],
  ["conclusion", "Conclusion"],
  ["method-and-scope", "Method and scope"],
] as const;

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textOf(child.props.children);
      }
      return "";
    })
    .join("");
}

function anchorFor(children: ReactNode) {
  return textOf(children)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const components: Components = {
  h2: ({ children }) => (
    <h2 id={anchorFor(children)} className={styles.sectionHeading}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={anchorFor(children)} className={styles.subheading}>
      {children}
    </h3>
  ),
  p: ({ children }) => {
    const content = Children.toArray(children);
    const only = content[0];
    if (
      content.length === 1 &&
      isValidElement<{ src?: string }>(only) &&
      typeof only.props.src === "string"
    ) {
      return <figure className={styles.figure}>{children}</figure>;
    }
    if (/^(Figure|Table) \d+\./.test(textOf(children))) {
      return <p className={styles.caption}>{children}</p>;
    }
    return <p>{children}</p>;
  },
  img: ({ src, alt }) => (
    <img
      src={
        typeof src === "string" && src.startsWith("figures/")
          ? `/research/three-gates-onchain/${src}`
          : src
      }
      alt={alt ?? ""}
    />
  ),
  a: ({ href, children }) => (
    <a href={href} rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}>
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className={styles.tableWrap}>
      <span className={styles.scrollHint}>Swipe to compare →</span>
      <div className={styles.tableScroll}>
        <table>{children}</table>
      </div>
    </div>
  ),
};

export function ThreeGatesResearch({ post }: Props) {
  return (
    <main className={styles.page}>
      <article className={styles.paper}>
        <header className={styles.header}>
          <div className={styles.masthead}>
            <Link href="/research">← Research</Link>
            <span>Aomi Labs / Security Research</span>
          </div>
          <p className={styles.series}>Research note · Agentic finance</p>
          <h1>{post.title}</h1>
          <p className={styles.subtitle}>{post.subtitle}</p>
          <div className={styles.byline}>
            <span>Aomi Labs Research</span>
            <time dateTime={post.isoDate}>{post.date}</time>
            <span>Security architecture</span>
          </div>
        </header>

        <div className={styles.summary}>
          <span>Abstract</span>
          <p>
            An agent can build a valid transaction from a false account of the
            user&apos;s intent or the state of the chain, or simply build the
            wrong one. We separate those two families of loss, adversarial
            attacks and capability defects, and argue that only the first is
            addressed by gates while the second is decided by model and harness.
            We then trace a transaction through four places it can be refused: a runtime guard while it is
            built, a wallet policy at signing, a mandate enforced by the smart
            account or protocol, and an assertion evaluated by the builder
            before inclusion. For each gate we ask what it can reject, who can
            change the rule, which route bypasses it and how it fails when its
            evaluator is down.
          </p>
          <p>
            We then survey the vendors now competing at each gate: MCP-boundary
            controls from AWS, Permit, Cloudflare and Lakera; signing policy at
            Privy, Turnkey, Coinbase CDP and Fireblocks; session and permission
            modules from ZeroDev, Biconomy, Rhinestone, Safe, Zodiac and
            EIP-7702; and pre-inclusion assertions from Phylax, Forta, BlockSec
            and Hypernative. We classify each by enforcement location and rule
            ownership rather than by marketing category, and include a
            first-party review of Aomi&apos;s own runtime. We close with a
            composite design: an action envelope that binds one action across
            all four gates, and a bypass test plan for any claimed coverage.
          </p>
        </div>

        <nav className={styles.contents} aria-label="Article sections">
          <span>In this article</span>
          <div>
            {sections.map(([id, label]) => (
              <a href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
          </div>
        </nav>

        <div className={styles.body}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {post.body}
          </ReactMarkdown>
        </div>

        <footer className={styles.footer}>
          <span>Aomi Labs Research</span>
          <Link href="/research">More research →</Link>
        </footer>
      </article>
    </main>
  );
}
