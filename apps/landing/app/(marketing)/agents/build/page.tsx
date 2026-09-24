import type { Metadata } from "next";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import styles from "../../longform.module.css";

export const metadata: Metadata = {
  title: "Build an Aomi App",
  description:
    "Turn your platform into an agentic application. Convert any API, SDK, or repo into an Aomi App hosted on our runtime — callable from any Aomi-compatible client.",
  openGraph: {
    title: "Build an Aomi App | Best Blockchain Harness for Agentic AI",
    description:
      "Turn your platform into an agentic application. Convert any API, SDK, or repo into an Aomi App hosted on our runtime — callable from any Aomi-compatible client.",
  },
  twitter: {
    title: "Build an Aomi App | Best Blockchain Harness for Agentic AI",
    description:
      "Turn your platform into an agentic application. Convert any API, SDK, or repo into an Aomi App hosted on our runtime — callable from any Aomi-compatible client.",
  },
  alternates: {
    types: {
      "text/markdown": "https://aomi.dev/agents/build.md",
    },
  },
};

export default function AgentsBuildPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Build</p>
        <h1>Build on Aomi</h1>
        <p>
          Turn your platform into an agentic application. Bring your APIs —
          OpenAPI, REST, SDK — and Aomi converts them into intent-shaped tools,
          deployed as an Aomi App hosted on our runtime, with built-in
          scalability and on-chain harness.
        </p>
        <div className={styles.heroActions}>
          <Link href="/agents/build.md">
            Open /agents/build.md
            <ArrowUpRight aria-hidden />
          </Link>
          <a href="https://aomi.dev/docs/">Open docs</a>
        </div>
      </header>

      <div className={styles.body}>
        <Link className={styles.backLink} href="/agents">
          <ArrowLeft aria-hidden />
          All agent guides
        </Link>

        <div className={styles.prose}>
          <h2>Tell your agent</h2>
          <blockquote>
            <p>
              &quot;Read https://aomi.dev/agents/build.md and build an Aomi app
              for our REST API at api.acme.com, with a ChatGPT-style
              frontend.&quot;
            </p>
          </blockquote>

          <h2>Scaffolding</h2>

          <p className={styles.commandLabel}>Backend in Rust</p>
          <div className={styles.commandBlock}>
            <code>cargo new my-aomi-app --lib &amp;&amp; cd my-aomi-app</code>
            <code>cargo add aomi-sdk</code>
          </div>

          <p className={styles.commandLabel}>Frontend widget</p>
          <div className={styles.commandBlock}>
            <code>npm install @aomi-labs/widget-lib</code>
          </div>

          <p className={styles.commandLabel}>
            Or build with our React TypeScript client
          </p>
          <div className={styles.commandBlock}>
            <code>pnpm install @aomi-labs/react</code>
          </div>
          <p>
            Aomi supports headless CLI, web UI, Telegram, Discord, and iOS
            frontends.
          </p>

          <h2>Skills</h2>
          <p>
            Install skills with <code>npx skills add aomi-labs/skills</code>.
          </p>
          <p>Use the canonical build workflow from the Aomi skills repo.</p>
          <p>
            Reach for the <Link href="/agents/build.md">markdown mirror</Link>{" "}
            when you need raw agent-readable text, or browse{" "}
            <a
              href="https://github.com/aomi-labs/skills"
              target="_blank"
              rel="noreferrer"
            >
              github.com/aomi-labs/skills
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
