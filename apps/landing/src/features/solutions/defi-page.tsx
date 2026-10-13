import {
  ArrowRight,
  Blocks,
  Check,
  Layers3,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MARKETING_ROOT } from "@/features/marketing/site";
import { ExecutionArchitecture } from "./execution-architecture";
import styles from "./defi.module.css";

const venueVerdicts = [
  {
    label: "Morpho Blue · Base",
    value: "4.47%",
    detail: "Highest net yield, but risk band B exceeds the mandate ceiling",
    outcome: "drift",
    status: "BLOCKED",
  },
  {
    label: "Aave v3 · Base",
    value: "4.11%",
    detail: "Band A, deposits open, 98M liquidity, no bridge required",
    outcome: "reconstructed",
    status: "SELECTED",
  },
  {
    label: "Sky Lending · Ethereum",
    value: "3.52%",
    detail: "Band A, but this cycle it would require a bridge",
    outcome: "reported",
    status: "ELIGIBLE",
  },
] as const;

const preparedSteps = [
  ["01", "Route", "Select Aave v3 on Base inside the band A allowlist"],
  ["02", "Build", "Batch approve and supply into one atomic operation"],
  ["03", "Simulate", "Rehearse the exact calls against forked live state"],
  ["04", "Verify", "Reconcile receipts against the resulting position"],
] as const;

const proofFacts = [
  ["Policy-bound", "every action checked before it is built"],
  ["Simulated", "exact calls rehearsed on forked live state"],
  ["Your signer", "keys and approval authority never move"],
  ["Reconciled", "receipts checked against the intended position"],
] as const;

const evidenceInputs = [
  "balances",
  "open positions",
  "routes",
  "quotes",
  "prices",
  "venue liquidity",
] as const;

const controlInputs = [
  "allowlists",
  "caps",
  "slippage",
  "risk bands",
  "call ordering",
  "postconditions",
] as const;

const catalogStages = [
  {
    icon: Blocks,
    title: "Liquidity Router",
    body: "Resolve a swap, bridge, or entry across venues, then hold the route inside slippage, allowlist, and value limits before anything is built.",
  },
  {
    icon: ShieldCheck,
    title: "Yield Manager",
    body: "Turn an approved current-to-target allocation into decoded calls, permission checks, simulations, and one reviewable signer packet.",
  },
  {
    icon: Layers3,
    title: "Incident Commander",
    body: "Map an alert to affected exposure, apply the approved risk-off runbook, and preserve the required action order.",
  },
  {
    icon: Waypoints,
    title: "Settlement Copilot",
    body: "Correlate signatures, receipts, final balances, and residual exposure into evidence a desk can explain and export, including shadow NAV for managed vaults.",
  },
] as const;

const benchResults = [
  { model: "opus-4.6", rate: 99.0, trailing: false },
  { model: "opus-4.8", rate: 98.0, trailing: false },
  { model: "sonnet-4.6", rate: 96.0, trailing: false },
  { model: "gpt-5.5", rate: 96.0, trailing: false },
  { model: "opus-4.7", rate: 94.8, trailing: false },
  { model: "minimax-m2.5", rate: 76.8, trailing: true },
  { model: "haiku-4.5", rate: 74.0, trailing: true },
] as const;

export function DefiPage() {
  const [showPreparedAction, setShowPreparedAction] = useState(false);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGrid} aria-hidden />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>AOMI FOR DEFI</p>
          <h1>DeFi with controlled agent action.</h1>
          <p className={styles.heroSubtitle}>
            Agent-driven liquidity operations within your mandate.
          </p>
          <p className={styles.lede}>
            Give an agent your liquidity objective and mandate. It can prepare
            swaps, move idle capital, rebalance positions, and respond to risk
            within those boundaries. Every action it proposes is checked against
            your policy, built as exact calls, simulated on forked live state,
            and signed by the wallet you already run.
          </p>
          <div className={styles.heroActions}>
            <a href="#operator-paths">
              See how control works <ArrowRight aria-hidden />
            </a>
            <a href="#operator-systems">What the agent runs</a>
          </div>
        </div>

        <div className={styles.seqCard} aria-label="Agent proposal demo">
          <header className={styles.demoMeta}>
            <span>ILLUSTRATIVE AGENT PROPOSAL</span>
            <strong>250,000 IDLE USDC</strong>
          </header>
          <div className={styles.demoPrompt}>
            Move the idle USDC into the best net yield. Risk band A only, and do
            not bridge this cycle.
          </div>
          <div className={styles.demoAnswer}>
            <span>POLICY CHECKED BEFORE ANYTHING IS BUILT</span>
            <h3>The best yield is not always the allowed one.</h3>
          </div>
          <ol className={styles.marketList}>
            {venueVerdicts.map((item) => (
              <li key={item.label} data-outcome={item.outcome}>
                <div>
                  <strong>{item.label}</strong>
                </div>
                <em>{item.value}</em>
                <span>{item.status}</span>
                <p>{item.detail}</p>
              </li>
            ))}
          </ol>
          <p className={styles.demoConclusion}>
            <strong>
              The mandate, not the model, decides what is allowed.
            </strong>{" "}
            This fixture routes to Aave v3, batches approve and supply,
            simulates the exact calls, and reconciles the resulting position.
          </p>
          <button
            className={styles.demoToggle}
            type="button"
            aria-expanded={showPreparedAction}
            onClick={() => setShowPreparedAction((current) => !current)}
          >
            {showPreparedAction
              ? "Hide the action packet"
              : "Inspect the action packet"}
            <span aria-hidden>{showPreparedAction ? "−" : "+"}</span>
          </button>
          {showPreparedAction ? (
            <ol className={styles.preparedAction}>
              {preparedSteps.map(([step, title, body]) => (
                <li key={step}>
                  <span>{step}</span>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          ) : null}
          <footer>
            <Check aria-hidden /> Nothing moves without policy · no keys held ·
            signer approval required
          </footer>
        </div>
      </section>

      <section
        className={styles.factRailFrame}
        aria-label="DeFi execution facts"
      >
        <div className={styles.proof}>
          {proofFacts.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.benchSection} aria-label="AomiBench results">
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Benchmarked, not asserted</p>
            <h2>Frontier models, measured through this harness.</h2>
          </div>
          <p>
            AomiBench scores each model on executable onchain tasks — real
            transactions, simulations, and chain-state evidence — with a
            deterministic verifier reading the chain, not a model reading a
            transcript.
          </p>
        </header>

        <div
          className={styles.benchChart}
          role="img"
          aria-label="Task success rate per model across 50 AomiBench specs: opus-4.6 99.0%, opus-4.8 98.0%, sonnet-4.6 96.0%, gpt-5.5 96.0%, opus-4.7 94.8%, minimax-m2.5 76.8%, haiku-4.5 74.0%"
        >
          {benchResults.map(({ model, rate, trailing }) => (
            <div className={styles.benchRow} key={model}>
              <span>{model}</span>
              <div>
                <i
                  className={trailing ? styles.benchBarMuted : styles.benchBar}
                  style={{ width: `${rate}%` }}
                />
              </div>
              <strong>{rate.toFixed(1)}</strong>
            </div>
          ))}
        </div>

        <p className={styles.benchNote}>
          Task success rate (%) · 50 specs · 2 passes · fixed scaffold · 694
          scorable runs, 90.6% overall — crediting 9 correct safety pauses
          raises it to 91.9%. From{" "}
          <Link to="/research/$slug" params={{slug: "aomibench-v0-1"}}>
            AomiBench: benchmarking frontier models on onchain execution
          </Link>
          .
        </p>
      </section>

      <section id="operator-paths" className={styles.paths}>
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>TWO WAYS IN</p>
            <h2>Keep the strategy. Bound the execution.</h2>
          </div>
          <p>
            Use the agent to decide, or keep your own model and use Aomi only to
            execute. Either way the same policy, simulation, and signer boundary
            sits between the decision and the chain.
          </p>
        </header>
        <div className={styles.pathGrid}>
          <article>
            <span>WANT THE AGENT TO DECIDE?</span>
            <h3>Let it manage the position.</h3>
            <p>
              State the outcome and the limits. The agent compares venues,
              routes the move, rebalances on a cadence, and proposes every
              action inside the risk bands and allowlists you set.
            </p>
            <a href="#operator-systems">
              See the control loops <ArrowRight aria-hidden />
            </a>
          </article>
          <article>
            <span>ALREADY HAVE A STRATEGY?</span>
            <h3>Bring your own model.</h3>
            <p>
              Submit the exact action or ordered batch your system selected.
              Aomi builds the calls, simulates them, runs the guards, and hands
              a sealed packet to your Safe, MPC, or wallet.
            </p>
            <a href="#architecture">
              Follow one action end to end <ArrowRight aria-hidden />
            </a>
          </article>
        </div>
        <div className={styles.coverageWall}>
          <div className={styles.coverageRow}>
            <span>Evidence</span>
            <div>
              {evidenceInputs.map((input) => (
                <em key={input}>{input}</em>
              ))}
            </div>
          </div>
          <div className={styles.coverageRow}>
            <span>Controls</span>
            <div>
              {controlInputs.map((input) => (
                <em key={input}>{input}</em>
              ))}
            </div>
          </div>
          <p className={styles.coverageNote}>
            Output: intent-to-target diff · decoded ordered calls · full-batch
            simulation · approval packet · receipts · final-state reconciliation
          </p>
        </div>
      </section>

      <ExecutionArchitecture />

      <section id="operator-systems" className={styles.catalog}>
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>WHAT THE AGENT RUNS</p>
            <h2>
              Accelerate risk-on and risk-off operations by adding AI to your
              control plane
            </h2>
          </div>
          <p>
            These loops complement your own models, protocol interfaces,
            monitors, and signer. They do not replace the strategy or assume
            investment authority.
          </p>
        </header>
        <ol className={styles.catalogFlow}>
          {catalogStages.map(({ icon: Icon, title, body }, index) => (
            <li key={title}>
              <div>
                <Icon aria-hidden />
                <span>0{index + 1}</span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className={styles.catalogCtaRow}>
          <Link to={`${MARKETING_ROOT}/products/rest-apis`}>
            See the deterministic execution APIs <ArrowRight aria-hidden />
          </Link>
        </div>
      </section>

      <section className={styles.cta}>
        <p className={styles.eyebrow}>START WITH ONE WORKFLOW</p>
        <h2>Bring one liquidity workflow and the limits it must respect.</h2>
        <p>
          Run it in rehearsal first. Keep the strategy, the models, and the
          keys. Aomi proves the current position, simulates the move, and
          packages the exact actions for the signer you already trust.
        </p>
        <div className={styles.ctaActions}>
          <a href="mailto:hello@aomi.dev?subject=DeFi%20workflow%20review">
            Map your first workflow <ArrowRight aria-hidden />
          </a>
          <a href="mailto:hello@aomi.dev?subject=Bring%20your%20own%20strategy">
            Bring your own strategy
          </a>
        </div>
      </section>
    </main>
  );
}
