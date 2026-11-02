import {
  ArrowRight,
  Building2,
  Check,
  FileCheck2,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import type { SolutionConfig } from "./solution-data";
import { MARKETING_ROOT } from "@/features/marketing/site";
import { FintechMandate } from "./sector-visuals";
import styles from "./sector-pages.module.css";

const proofStats = [
  {
    value: "9 mo",
    unit: "→ days",
    label: "integration work replaced per venue — no execution stack to build",
  },
  {
    value: "100",
    unit: "%",
    label: "of transactions simulated on forked live state before signature",
  },
  {
    value: "0",
    unit: "keys",
    label: "held by the platform — signing authority never transfers",
  },
  {
    value: "1",
    unit: "harness",
    label: "across every venue and chain, EVM + SVM",
  },
] as const;

const operatingLayers = [
  {
    icon: Landmark,
    label: "Mandate",
    title: "Define what the capital is allowed to do.",
    body: "Encode liquidity floors, issuer allowlists, concentration limits, and approval roles before execution begins. The policy is the permission — not a promise.",
  },
  {
    icon: ShieldCheck,
    label: "Operation",
    title: "Rehearse the complete allocation before signing.",
    body: "Compare net yield and redemption windows, then simulate every action as one policy-bound proposal on a fork of live chain state.",
  },
  {
    icon: FileCheck2,
    label: "Record",
    title: "Keep an independent set of books.",
    body: "Reconstruct what the account owns and owes from chain state, compare it with the reported position, and link every drift to the mandate, payload, and signer that caused it.",
  },
] as const;

const caseSteps = [
  {
    label: "01 · The endpoints Somm already operated",
    title: "The strategy stays with the manager.",
    body: "Five endpoints — the models, data, and risk framework Somm already ran. Nothing was rewritten.",
    code: [
      "GET  /idle-assets",
      "GET  /risk-snapshot",
      "POST  /assess-position",
      "GET  /credit-balance",
      "POST  /propose-intent",
    ],
  },
  {
    label: "02 · Tools + mandate = an Aomi app",
    title: "No net-new engineering.",
    body: "Endpoints wrap into tools; the investment mandate becomes enforced configuration rather than a document.",
    code: [
      "Manage idle treasury assets for Somm.",
      "Seek best net yield.",
      "Never exceed risk band B.",
      "Always propose before execution.",
    ],
  },
  {
    label: "03 · Deployed in the hosted runtime",
    title: "One agent, every surface.",
    body: "The same runtime that operates the vault faces depositors on web, Telegram, and Discord — and settles an app-level fee the product did not previously have.",
    code: [
      "keys held        0",
      "fork latency     ~200 ms",
      "fees             x402 · settled onchain",
      "status           in production",
    ],
  },
] as const;

const lifecycle = [
  [
    "01",
    "Mandate received",
    "Treasury instruction, account scope, and the policy it must satisfy",
  ],
  [
    "02",
    "Policy evaluated",
    "Issuer, liquidity, and concentration controls pass before anything is shown for approval",
  ],
  [
    "03",
    "Simulated, then signed by you",
    "Exact payload rehearsed on forked state; your signer and approval roles stay in place",
  ],
  [
    "04",
    "Position reconciled",
    "Reported vs. reconstructed holdings compared after settlement; drift is flagged to a named owner",
  ],
] as const;

type ControlStatus = "live" | "roadmap" | "preparing";

const controlRows: readonly {
  title: string;
  body: string;
  status: ControlStatus;
}[] = [
  {
    title: "Custody architecture",
    body: "Non-custodial by construction — zero keys held, delegation scoped and revocable at any time.",
    status: "live",
  },
  {
    title: "Pre-trade simulation & policy checks",
    body: "Every transaction simulated against forked live state and checked against the mandate before signature.",
    status: "live",
  },
  {
    title: "Kill switch & revocation",
    body: "Delegation is data, not a handover. Halt an agent or revoke a grant instantly; an out-of-policy proposal stops before signature.",
    status: "live",
  },
  {
    title: "Signing integrations · Privy, Para",
    body: "Provider-native scoped delegation through the wallet infrastructure a desk already operates.",
    status: "live",
  },
  {
    title: "Safe (multisig) integration",
    body: "Execution under Safe-based policy for treasuries and mandates operating on multisig today.",
    status: "roadmap",
  },
  {
    title: "Independent security audits",
    body: "Third-party review of the runtime and delegation layer; reports published on completion.",
    status: "preparing",
  },
  {
    title: "SOC 2 Type II",
    body: "Controls program underway toward independent attestation.",
    status: "preparing",
  },
];

const statusLabel: Record<ControlStatus, string> = {
  live: "Live today",
  roadmap: "Roadmap",
  preparing: "In preparation",
};

export function FintechPage({ solution }: { solution: SolutionConfig }) {
  return (
    <main className={styles.fintechPage}>
      <section className={`${styles.sectorHero} ${styles.fintechHero}`}>
        <div className={styles.sectorHeroCopy}>
          <p className={styles.eyebrow}>{solution.eyebrow}</p>
          <h1>{solution.headline}</h1>
          <p className={styles.sectorLede}>{solution.lede}</p>
          <div className={styles.heroActions}>
            <Link to={`${MARKETING_ROOT}/contact`}>
              Request the due-diligence pack <ArrowRight aria-hidden />
            </Link>
            <a href="#mandate-workspace">Inspect the workflow</a>
          </div>
          <p className={styles.heroAudience}>{solution.audience}</p>
        </div>

        <div id="mandate-workspace" className={styles.heroArtifact}>
          <FintechMandate />
          <p className={styles.artifactCaption}>
            Illustrative mandate · every step simulated on forked state · no
            live capital is moved
          </p>
        </div>
      </section>

      <section
        className={styles.factRailFrame}
        aria-label="Fintech execution facts"
      >
        <div className={`${styles.proofRail} ${styles.fintechStats}`}>
          {proofStats.map(({ value, unit, label }) => (
            <div key={label}>
              <strong>
                {value} <em>{unit}</em>
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.fintechOperating}>
        <header className={styles.splitHeading}>
          <div>
            <p className={styles.eyebrow}>The operating model</p>
            <h2>Automation that behaves like financial software.</h2>
          </div>
          <p>{solution.valueIntro}</p>
        </header>

        <div className={styles.operatingGrid}>
          {operatingLayers.map(({ icon: Icon, label, title, body }, index) => (
            <article key={label}>
              <div>
                <Icon aria-hidden />
                <span>0{index + 1}</span>
              </div>
              <p>{label}</p>
              <h3>{title}</h3>
              <span>{body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.caseSection} aria-labelledby="case-title">
        <header className={styles.caseHeading}>
          <p className={styles.caseTag}>
            <i aria-hidden /> In production · Somm Finance
          </p>
          <h2 id="case-title">From managed vault to agent-operated product.</h2>
          <p>
            Somm Finance ran an actively managed liquidity vault: five operating
            endpoints, a defined risk mandate, and execution limited to one
            surface and manual operations. The endpoints wrapped into tools, the
            mandate became enforced configuration, and the composed agent
            deployed into the hosted runtime.
          </p>
        </header>

        <div className={styles.caseGrid}>
          {caseSteps.map(({ label, title, body, code }) => (
            <article key={label}>
              <p className={styles.caseStepLabel}>{label}</p>
              <pre className={styles.caseCode}>
                {code.map((line) => {
                  // Alignment in the source strings is padding spaces. Split on
                  // it so label and value become real grid tracks that stay
                  // aligned and wrap instead of overflowing a narrow column.
                  const [label, value] = line.split(/\s{2,}/);
                  return value === undefined ? (
                    <span className={styles.caseCodeLine} key={line}>
                      {line}
                    </span>
                  ) : (
                    <Fragment key={line}>
                      <span>{label}</span>
                      <span>{value}</span>
                    </Fragment>
                  );
                })}
              </pre>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>

        <footer className={styles.caseOutcome}>
          <div>
            <span>Outcome</span>
            <strong>
              One agent executes the vault&apos;s operations and faces
              depositors on every surface — with app-level fees settled
              on-rails, a revenue line that did not previously exist.
            </strong>
          </div>
          <ul>
            <li>app-level fees · live on Aomi rails</li>
            <li>x402 pricing · onchain settlement</li>
            <li>shipped · agentic.somm.finance</li>
          </ul>
        </footer>
      </section>

      <section className={styles.mandateLifecycle}>
        <div className={styles.lifecycleIntro}>
          <p className={styles.eyebrow}>One mandate, one durable record</p>
          <h2>Every decision survives the transaction.</h2>
          <p>
            The allocation is only half the product. Operations needs the
            instruction, controls, approval, and resulting position to remain
            connected after settlement — and needs to know, independently of the
            venue, when the reported value stops matching what the account
            actually holds.
          </p>
        </div>

        <ol className={styles.lifecycleList}>
          {lifecycle.map(([number, title, body]) => (
            <li key={number}>
              <span>{number}</span>
              <div>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
              <Check aria-hidden />
            </li>
          ))}
        </ol>
      </section>

      <section
        className={styles.controlsSection}
        aria-labelledby="controls-title"
      >
        <header className={styles.splitHeading}>
          <div>
            <p className={styles.eyebrow}>Control framework & posture</p>
            <h2 id="controls-title">
              Stated as-is. Nothing claimed before it is held.
            </h2>
          </div>
          <p>
            The invariant: Aomi can compose and simulate any transaction, but
            can only ever propose it. Authority to move value remains with the
            mandate holder&apos;s wallet and policy — including for operations
            that run unattended.
          </p>
        </header>

        <table className={styles.controlsTable}>
          <thead>
            <tr>
              <th scope="col">Control</th>
              <th scope="col">What it means for your operations</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {controlRows.map(({ title, body, status }) => (
              <tr key={title}>
                <th scope="row">{title}</th>
                <td>{body}</td>
                <td>
                  <span
                    className={`${styles.statusPill} ${styles[`status-${status}`]}`}
                  >
                    {statusLabel[status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.controlsNote}>
          Current status of every item is kept current in the due-diligence
          pack.
        </p>
      </section>

      <section className={styles.fintechFit}>
        <div>
          <Building2 aria-hidden />
          <span>Your institution keeps</span>
          <strong>Customer record</strong>
          <strong>Custody model</strong>
          <strong>Reporting system</strong>
          <strong>Approval roles</strong>
        </div>
        <div>
          <ShieldCheck aria-hidden />
          <span>Aomi adds</span>
          <strong>Mandate-aware construction</strong>
          <strong>Complete simulation</strong>
          <strong>Policy verdicts</strong>
          <strong>Reconciled Actions</strong>
        </div>
      </section>

      <section className={styles.sectorCta}>
        <p className={styles.eyebrow}>Start with one operation</p>
        <h2>{solution.finalTitle}</h2>
        <p>
          Bring one real mandate. We run read-only first: mirror the account,
          reconstruct the position, and return a shadow proposal with exact
          simulated calls — then map the policy, signer, execution, and receipt
          boundaries with your team.
        </p>
        <Link to={`${MARKETING_ROOT}/contact`}>
          Request the due-diligence pack <ArrowRight aria-hidden />
        </Link>
      </section>
    </main>
  );
}
