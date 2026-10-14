import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import styles from "../../longform.module.css";

export const metadata: Metadata = {
  title: "Transact with Aomi",
  description:
    "Execute on-chain transactions through the Aomi CLI — swap, send, stake, bridge across any on-chain protocol or off-chain API. The Aomi runtime resolves intents and simulates every transaction on a multi-chain fork before signing, so malformed calldata never reaches the user's wallet. The execution layer of the blockchain harness for agentic AI.",
  openGraph: {
    title: "Transact with Aomi | Best Blockchain Harness for Agentic AI",
    description:
      "Execute on-chain operations through the Aomi CLI — swap, send, stake, bridge across any protocol or API. The Aomi runtime simulates every transaction on a multi-chain fork before signing, so malformed calldata never reaches the user's wallet.",
  },
  twitter: {
    title: "Transact with Aomi | Best Blockchain Harness for Agentic AI",
    description:
      "Execute on-chain operations through the Aomi CLI — swap, send, stake, bridge across any protocol or API. The Aomi runtime simulates every transaction on a multi-chain fork before signing, so malformed calldata never reaches the user's wallet.",
  },
  alternates: {
    types: {
      "text/markdown": "https://aomi.dev/agents/transact.md",
    },
  },
};

export default function AgentsTransactPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Transact</p>
        <h1>Execute on-chain operations through the Aomi CLI.</h1>
        <p>
          Swap, send, stake, lend, and bridge across any on-chain protocol or
          off-chain API on Ethereum, Base, Arbitrum, Polygon, Optimism, and
          Sepolia. The Aomi runtime resolves the intent, builds the
          transactions, and simulates them on a multi-chain fork before signing
          — malformed calldata, failed approvals, and unexpected reverts are
          caught before they ever reach the user&apos;s wallet. You sign
          locally; the bundle settles atomically via account abstraction — the
          execution layer of the blockchain harness for agentic AI.
        </p>
        <div className={styles.heroActions}>
          <Link to="/agents/transact.md" reloadDocument>
            Open /agents/transact.md
            <ArrowUpRight aria-hidden />
          </Link>
          <a
            href="https://github.com/aomi-labs/skills"
            target="_blank"
            rel="noreferrer"
          >
            github.com/aomi-labs/skills
            <ArrowUpRight aria-hidden />
          </a>
        </div>
      </header>

      <div className={styles.body}>
        <Link className={styles.backLink} to="/agents">
          <ArrowLeft aria-hidden />
          All agent guides
        </Link>

        <div className={styles.prose}>
          <h2>Install</h2>
          <p>
            Install the CLI with <code>npm install -g @aomi-labs/client</code>.
          </p>
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
      </div>
    </main>
  );
}
