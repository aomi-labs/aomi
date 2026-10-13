import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Command,
  MonitorCheck,
  Network,
  ShieldCheck,
} from "lucide-react";
import { AgenticLab } from "./agentic-lab";
import { SurfaceFlow } from "./surface-flow";
import styles from "./agentic-surfaces.module.css";

const DOCS = {
  skills: "https://aomi.dev/docs/guides/skills",
  mcp: "https://aomi.dev/docs/guides/mcp",
  cli: "https://aomi.dev/docs/reference/client-cli",
} as const;

export const metadata: Metadata = {
  title: "Agentic Toolings | Aomi",
  description:
    "Choose Agent Skills, hosted MCP, or the Aomi CLI and connect your existing agent to Aomi's account-owned execution harness.",
  robots: { index: false, follow: false },
};

const surfaces = [
  {
    id: "skills",
    index: "01",
    title: "Agent Skills",
    body: "Teach Codex, Claude Code, or Cursor the correct Aomi workflow before the agent touches a transaction.",
    bestFor: "Guided trading and App-building workflows",
    action: "Install Skills",
    href: "#setup",
  },
  {
    id: "mcp",
    index: "02",
    title: "Hosted MCP",
    body: "Connect any supported MCP client to account-owned Aomi sessions through browser OAuth.",
    bestFor: "Hosted conversations with almost no local setup",
    action: "Connect MCP",
    href: "#setup",
  },
  {
    id: "cli",
    index: "03",
    title: "Client CLI",
    body: "Work directly with chat, sessions, simulation, and signing from the terminal you already operate.",
    bestFor: "Operators, scripting, and local wallet control",
    action: "Install CLI",
    href: "#setup",
  },
] as const;

const together = [
  {
    icon: Bot,
    title: "Skills teach the workflow",
    body: "Give the outer agent durable instructions for choosing chain context, simulating first, and stopping at approval.",
  },
  {
    icon: Network,
    title: "MCP creates the hosted thread",
    body: "The client works inside an OAuth-authorized, account-owned Aomi conversation without receiving wallet secrets.",
  },
  {
    icon: MonitorCheck,
    title: "Portal makes review visible",
    body: "Open an awaiting request in a visual wallet surface to inspect the exact staged action before approval.",
  },
  {
    icon: Command,
    title: "CLI resumes and signs",
    body: "Pick up the same supported session locally, simulate again, and sign from the machine that controls the wallet.",
  },
] as const;

export function AgentToolingsPageContent({
  productName = "Agentic Toolings",
}: {
  productName?: string;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={`${styles.heroGrid} ${styles.heroCentered}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>{productName}</p>
              <h1>Bring transaction capability to your existing agent stack</h1>
              <p className={styles.heroSupport}>
                Connect coding agents through Skills, hosted MCP, or the CLI.
                Three surfaces, one account-owned execution lifecycle.
              </p>
              <div className={styles.heroActions}>
                <Link to="." search={true} hash="surfaces" className={styles.primaryButton}>
                  Choose a surface
                  <ArrowRight aria-hidden />
                </Link>
                <a
                  href={DOCS.mcp}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.secondaryButton}
                >
                  Read the docs
                  <ArrowUpRight aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="surfaces" className={styles.surfaceSection}>
        <div className={styles.shell}>
          <SurfaceFlow surfaces={surfaces} />
        </div>
      </section>

      <section className={styles.benchBand} aria-label="AomiBench results">
        <div className={styles.shell}>
          <span className={styles.benchBandLabel}>
            Benchmarked on AomiBench
          </span>
          <div className={styles.benchBandStats}>
            <div>
              <strong>700</strong>
              <span>runs · 7 frontier models</span>
            </div>
            <div>
              <strong>90.6%</strong>
              <span>task success, verified onchain</span>
            </div>
            <div>
              <strong>94.8–99%</strong>
              <span>frontier-cluster success rate</span>
            </div>
            <div>
              <strong>9</strong>
              <span>safety pauses correctly taken</span>
            </div>
          </div>
          <Link to="/research/$slug" params={{slug: "aomibench-v0-1"}}>Read the research</Link>
        </div>
      </section>

      <AgenticLab />

      <section className={styles.togetherSection}>
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>USE THEM TOGETHER</p>
              <h2>One execution workflow can continue across every surface.</h2>
            </div>
            <div className={styles.taskPrompt}>
              <span>Prompt</span>
              <p>
                “Find my USDC balance on Base, then prepare a simulated
                deposit.”
              </p>
            </div>
          </div>
          <div className={styles.togetherGrid}>
            {together.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title}>
                  <div>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.shell}>
          <ShieldCheck aria-hidden className={styles.finalMark} />
          <p className={styles.eyebrow}>READY WHEN YOU ARE</p>
          <h2>Start where your agent already works.</h2>
          <div className={styles.finalActions}>
            <a href={DOCS.skills} target="_blank" rel="noreferrer">
              Install Agent Skills <ArrowUpRight aria-hidden />
            </a>
            <a href={DOCS.mcp} target="_blank" rel="noreferrer">
              Connect MCP <ArrowUpRight aria-hidden />
            </a>
            <a href={DOCS.cli} target="_blank" rel="noreferrer">
              Install the CLI <ArrowUpRight aria-hidden />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function AgenticSurfacesPage() {
  return <AgentToolingsPageContent />;
}
