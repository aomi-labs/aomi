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
  ["a-gate-is-defined-by-its-enforcement-point", "The enforcement map"],
  [
    "gate-0-5-runtime-controls-remain-inside-the-application-boundary",
    "0.5 / Runtime controls",
  ],
  [
    "gate-1-wallet-custody-becomes-a-gate-only-with-independent-policy",
    "1 / Independent wallet policy",
  ],
  [
    "gate-2-onchain-mandates-govern-only-the-execution-paths-they-cover",
    "2 / Onchain mandates",
  ],
  [
    "gate-3-builder-assertions-are-final-but-path-dependent",
    "3 / Builder assertions",
  ],
  [
    "the-gates-must-evaluate-the-same-transaction",
    "Composing the architecture",
  ],
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
            Agentic finance relies on multiple security controls between user
            authorization and onchain settlement. Two failure classes define
            the problem. Adversarial attacks corrupt intent, observed state or
            transaction handling. Capability defects produce incorrect
            transactions without hostile input. Gates can constrain unsafe
            outcomes from either class, while the model and execution harness
            determine how often capability defects occur. This article traces a
            transaction through a preliminary runtime guard and three settlement
            gates. It compares leading implementations by enforcement scope,
            governing authority, bypass paths and failure posture.
          </p>
          <span className={styles.findingsLabel}>Key findings</span>
          <ul>
            <li>
              Runtime controls improve transaction construction and enforce local
              policy, but remain inside the application trust boundary.
            </li>
            <li>
              A wallet becomes an independent gate only when the application
              cannot relax its policy or bypass its signing route.
            </li>
            <li>
              Onchain mandates provide authoritative enforcement only for the
              account and execution paths they govern.
            </li>
            <li>
              Builder assertions provide a final pre-inclusion decision, but
              their protection depends on the integrated builder path.
            </li>
          </ul>
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
