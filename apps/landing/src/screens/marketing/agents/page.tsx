import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowUpRight, Blocks, MessageSquare, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import styles from "../longform.module.css";

export const metadata: Metadata = {
  title: "Aomi for Agents",
  description:
    "Aomi is the blockchain harness for agentic AI. Pick a path: transact on wallets, embed a chat surface, or expose your product as callable AI tools.",
  openGraph: {
    title: "Aomi for Agents | Best Blockchain Harness for Agentic AI",
    description:
      "Pick a path: transact on wallets, embed a chat surface, or expose your product as callable AI tools. Read by default, simulate before sign, credentials never round-trip.",
  },
  twitter: {
    title: "Aomi for Agents | Best Blockchain Harness for Agentic AI",
    description:
      "Pick a path: transact on wallets, embed a chat surface, or expose your product as callable AI tools. Read by default, simulate before sign, credentials never round-trip.",
  },
  alternates: {
    types: {
      "text/markdown": "https://aomi.dev/agents.md",
    },
  },
};

export default function AgentsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>For agents</p>
        <h1>The blockchain harness for agentic AI.</h1>
        <p>
          Use Aomi to transact on wallets, embed a chat surface, or expose your
          product as callable AI tools — non-custodial by design, with
          simulation and local signing built in.
        </p>
        <div className={styles.heroActions}>
          <Link to="/agents.md" reloadDocument>
            Read as markdown
            <ArrowUpRight aria-hidden />
          </Link>
          <a href="https://aomi.dev/docs/">Documentation</a>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionLead}>
          <p className={styles.eyebrow}>Guarantees</p>
          <h2>Three guarantees define the harness</h2>
        </div>
        <div className={styles.claimList}>
          <div>
            <strong>Read by default</strong>
            <p>
              Chat, prices, balances, and simulations require no signing key.
            </p>
          </div>
          <div>
            <strong>Simulate before sign</strong>
            <p>
              Every transaction is dry-run on a forked chain before it can be
              signed.
            </p>
          </div>
          <div>
            <strong>Credentials never round-trip</strong>
            <p>
              Private keys stay on the user&apos;s machine; the agent never sees
              them.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLead}>
          <p className={styles.eyebrow}>Axis by axis</p>
          <h2>A coding agent&apos;s loop, with a chain for a world</h2>
          <p>
            The same read, propose, verify, commit skeleton — but the world
            being mutated is a wallet on a chain, so authority and judgment move
            out of the agent&apos;s hands.
          </p>
        </div>
        <div className={`${styles.prose} ${styles.proseWide}`}>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th />
                  <th scope="col">Coding agent</th>
                  <th scope="col">Aomi agent</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">State / world</th>
                  <td>codebase + OS: files, processes, env</td>
                  <td>
                    chain at a pinned fork block + wallet: balances, storage,
                    positions
                  </td>
                </tr>
                <tr>
                  <th scope="row">Read</th>
                  <td>
                    <code>cat</code>, <code>grep</code>, <code>ls</code>, read
                    file
                  </td>
                  <td>
                    <code>get_account_info</code>, <code>get_contract</code>,{" "}
                    <code>encode_and_call</code>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Propose</th>
                  <td>edit file (open-ended)</td>
                  <td>
                    <code>stage_tx</code> from a typed, namespaced tool catalog
                  </td>
                </tr>
                <tr>
                  <th scope="row">Verify before</th>
                  <td>run tests / build (cheap, repeatable)</td>
                  <td>
                    <code>simulate_batch</code> — dry-run against the fork
                  </td>
                </tr>
                <tr>
                  <th scope="row">Commit</th>
                  <td>
                    write to disk — <strong>the agent has authority</strong>
                  </td>
                  <td>
                    <code>commit_txs</code> → wallet request → wallet signs —{" "}
                    <strong>the agent does not</strong>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Judge</th>
                  <td>tests pass? OS output correct?</td>
                  <td>balance Δ correct? event emitted? final state right?</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            From{" "}
            <Link to="/research/$slug" params={{slug: "aomibench-v0-1"}}>
              AomiBench: benchmarking frontier models on onchain execution
            </Link>
            .
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLead}>
          <p className={styles.eyebrow}>Paths</p>
          <h2>Pick the surface you are building on</h2>
        </div>
        <div className={styles.cardGrid}>
          <article>
            <Wallet aria-hidden />
            <h3>Transact</h3>
            <p>Drive the Aomi CLI for reads, simulations, and signing flows.</p>
            <div className={styles.cardLinks}>
              <Link to="/agents/transact">Open HTML guide</Link>
              <i aria-hidden />
              <Link to="/agents/transact.md" reloadDocument>Raw markdown</Link>
            </div>
          </article>
          <article>
            <MessageSquare aria-hidden />
            <h3>Embed</h3>
            <p>
              Add the bundled widget or build a custom UI with the headless
              React library.
            </p>
            <div className={styles.cardLinks}>
              <a href="/docs/guides/integration">Integration guide</a>
            </div>
          </article>
          <article>
            <Blocks aria-hidden />
            <h3>Build</h3>
            <p>
              Turn an API, SDK, or repo into an Aomi app with a clean tool
              surface.
            </p>
            <div className={styles.cardLinks}>
              <Link to="/agents/build">Open HTML guide</Link>
              <i aria-hidden />
              <Link to="/agents/build.md" reloadDocument>Raw markdown</Link>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
