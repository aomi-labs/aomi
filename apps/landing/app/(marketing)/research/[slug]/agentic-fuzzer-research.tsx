import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./agentic-fuzzer-research.module.css";

const richBlockPattern =
  /(::fuzzer-(?:define|count|roles|jobs|trace|evidence|harness|facts|roadmap)::)/;

function Define() {
  return (
    <section className={styles.define}>
      <p className={styles.eyebrow}>What agentic fuzzing is, in three sentences</p>
      <ol>
        <li>
          <span>
            <strong>The agent proposes.</strong> It reads the source and the
            compiled artifact, writes the threat model, and turns it into
            executable rules, actor roles and ordered call sequences. It never
            decides whether something is a bug.
          </span>
        </li>
        <li>
          <span>
            <strong>The engine judges.</strong> Deterministic code in an Aomi
            app owns the search. It rejects plans it cannot check, minimizes
            each violation to its shortest form and requires two clean replays
            before anything is reported.
          </span>
        </li>
        <li>
          <span>
            <strong>The fork executes.</strong> A private Arc fork pinned at one
            block runs every sequence as real actors. Nothing is signed,
            deployed or broadcast, and no contract is ever called safe.
          </span>
        </li>
      </ol>
    </section>
  );
}

function Count() {
  return (
    <div className={styles.count}>
      <div className={styles.tile}>
        <b>14</b>
        <span>writable functions</span>
      </div>
      <i className={styles.op}>×</i>
      <div className={styles.tile}>
        <b>4</b>
        <span>example actors: owner, lender, borrower, attacker</span>
      </div>
      <i className={styles.op}>=</i>
      <div className={styles.tile}>
        <b>56</b>
        <span>possible actions per step</span>
      </div>
      <i className={styles.op}>→</i>
      <div className={`${styles.tile} ${styles.tileHot}`}>
        <b>175,616</b>
        <span>ordered 3-call sequences (56³)</span>
      </div>
    </div>
  );
}

function Roles() {
  return (
    <div className={styles.roles}>
      <div className={`${styles.role} ${styles.roleAgent}`}>
        <span className={styles.tag}>The agent proposes</span>
        <h4>Threat model and plan</h4>
        <p>
          Reads source and attack surface; chooses actors, rules and actions;
          revises when calls revert; drafts the fix.
        </p>
        <p className={styles.never}>Never decides whether something is a bug.</p>
      </div>
      <div className={styles.role}>
        <span className={styles.tag}>The engine judges</span>
        <h4>Search state and truth</h4>
        <p>
          Rejects plans it cannot check; owns the frontier, dedup and
          priorities; minimizes and demands two replays.
        </p>
        <p className={styles.never}>
          Deterministic code in an Aomi app, not model memory.
        </p>
      </div>
      <div className={`${styles.role} ${styles.roleFork}`}>
        <span className={styles.tag}>The fork executes</span>
        <h4>What actually happened</h4>
        <p>
          A held Arc fork pinned at one block installs or targets the contract,
          replays sequences, reports balances and reverts.
        </p>
        <p className={styles.never}>Never signs or broadcasts to Arc.</p>
      </div>
    </div>
  );
}

const jobs = [
  [
    "Attack-surface map",
    "From the compiled artifact, not the model's reading: signatures, payable entry points, observers, source risk signals.",
  ],
  [
    "Plan validation",
    "A plan that skips a writable function, or has a rule the engine cannot check, goes back to the agent.",
  ],
  [
    "Frontier and dedup",
    "The engine owns the frontier. Known state shapes are pruned; new behaviour is kept.",
  ],
  [
    "Prioritisation",
    "Paths where a rule starts to bend are explored first. Budget follows the evidence.",
  ],
  ["Minimization", "Each violation is cut to its shortest failing sequence."],
  [
    "Replay",
    "The minimized sequence must replay cleanly twice from baseline. Code decides, not the model.",
  ],
  [
    "Reporting",
    "Replayed findings, rules held within budget, surfaces not reached, and unrun ideas labelled as hypotheses.",
  ],
];

function Jobs() {
  return (
    <dl className={styles.jobs}>
      {jobs.map(([job, meaning]) => (
        <div key={job}>
          <dt>{job}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

const traceCalls = [
  ["arc_fuzz_start", "snapshot · 2 writable functions"],
  ["sim_replay_traces", "batch 1 · 4 traces"],
  ["arc_fuzz_round", "frontier 8 · expanded 2"],
  ["sim_replay_traces", "batch 2 · 3 traces"],
  ["arc_fuzz_round", "frontier 0 · expanded 2"],
  ["sim_replay_traces", "replay ×2 from baseline"],
  ["arc_fuzz_report", "1 finding · 0 hypotheses"],
];

const tools = [
  [
    "arc_fuzz_start",
    "Maps the attack surface, snapshots the fork, seeds action templates.",
  ],
  ["arc_fuzz_round", "Expands the frontier under the engine's priorities."],
  [
    "sim_replay_traces",
    "Executes candidate sequences on the fork from baseline.",
  ],
  [
    "arc_fuzz_report",
    "Returns replayed findings, rules held within budget, and hypotheses.",
  ],
];

function Trace() {
  return (
    <section className={styles.trace}>
      <div className={styles.traceLog}>
        <p>Live agent trace · UnsafeVault</p>
        <ol>
          {traceCalls.map(([tool, note], index) => (
            <li key={`${tool}-${index}`}>
              <i>✓</i>
              {tool}
              <span>{note}</span>
            </li>
          ))}
        </ol>
        <div className={styles.traceHit}>
          unauthorized_withdraw_must_revert broken · replayed 2 of 2
        </div>
      </div>
      <div className={styles.traceTools}>
        <h4>Why the trace matters</h4>
        <p>
          Every step the agent takes is a typed tool call into the engine, and
          every result comes from the fork. The model cannot assert an outcome;
          it can only start a campaign, ask for a round and read the report.
        </p>
        <dl>
          {tools.map(([tool, meaning]) => (
            <div key={tool}>
              <dt>{tool}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const statusRows: [string, string, "yes" | "no" | "never"][] = [
  ["Attack surface mapped from the compiled artifact", "Observed", "yes"],
  [
    "Agent wrote the threat model, rules, actors and actions",
    "Observed",
    "yes",
  ],
  [
    "Breadth-first search of multi-actor sequences on the held fork",
    "Observed",
    "yes",
  ],
  [
    "Violation minimized and replayed twice from baseline",
    "Observed · 2 of 2",
    "yes",
  ],
  ["Agent explained the finding and drafted a fix", "Observed", "yes"],
  ["Finding on a real Arc Studio app or customer contract", "Not yet", "no"],
  ["Fix written back to Arc Studio and re-verified", "Not built", "no"],
  [
    "Any signature, deployment or broadcast to Arc",
    "Never, by design",
    "never",
  ],
];

function Evidence() {
  return (
    <>
      <div className={styles.evidence}>
        <section className={styles.finding}>
          <header className={styles.findingHead}>
            <span>Verified finding</span>
            <i>Replayed 2×</i>
          </header>
          <h4>Unauthorized withdrawal must revert</h4>
          <ol>
            <li>
              <span>
                alice → <code>deposit()</code>
              </span>
            </li>
            <li>
              <span>
                bob → <code>withdraw(uint256)</code>
              </span>
            </li>
          </ol>
          <div className={styles.counters}>
            <div>
              <span>Round</span>
              <b>4</b>
            </div>
            <div>
              <span>Executions</span>
              <b>10</b>
            </div>
            <div>
              <span>Corpus</span>
              <b>4</b>
            </div>
          </div>
          <footer>prototype run · Arc fork · no signing</footer>
        </section>
        <dl className={styles.meta}>
          <div>
            <dt>Target</dt>
            <dd>UnsafeVault, from a local mock, not a real deployment</dd>
          </div>
          <div>
            <dt>Fork</dt>
            <dd>Arc mainnet fork, chain 5042, pinned at block 24,244,814</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>
              Rule broken. Minimized, then replayed from baseline 2 of 2
              before it was reported.
            </dd>
          </div>
          <div>
            <dt>Writes</dt>
            <dd>None on Arc. Simulation only.</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>Claude, the production default</dd>
          </div>
        </dl>
      </div>
      <ul className={styles.status}>
        {statusRows.map(([step, status, kind]) => (
          <li
            className={
              kind === "no"
                ? styles.statusNo
                : kind === "never"
                  ? styles.statusNever
                  : undefined
            }
            key={step}
          >
            {step}
            <span>{status}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Harness() {
  return (
    <section className={styles.pair}>
      <div>
        <h4>What the harness already supplies</h4>
        <ul>
          <li>
            <span>
              <strong>Held chain forks.</strong> Shared chain access with fresh
              live state for every run, on EVM chains including Arc.
            </span>
          </li>
          <li>
            <span>
              <strong>Typed tools and deterministic engines.</strong> Apps are
              compiled Rust plugins that run their own code next to the model.
            </span>
          </li>
          <li>
            <span>
              <strong>Model routing.</strong> OpenAI, Anthropic Claude, Google
              Gemini and open models, chosen per app or per campaign.
            </span>
          </li>
          <li>
            <span>
              <strong>Bounded runs and a record.</strong> Hard limits on model
              calls, sub-agents and time, with intent, tool calls and results
              kept as one record.
            </span>
          </li>
          <li>
            <span>
              <strong>Non-custodial by design.</strong> Aomi never holds keys.
            </span>
          </li>
        </ul>
      </div>
      <div>
        <h4>What the Agentic Fuzzer adds</h4>
        <ul>
          <li>
            <span>
              <strong>The attack-surface mapper.</strong> Reads the compiled
              artifact for signatures, payable entry points, observers and risk
              signals.
            </span>
          </li>
          <li>
            <span>
              <strong>The campaign engine.</strong> Breadth-first search over
              ordered multi-actor sequences, with plan validation, dedup,
              minimization and two-replay proof.
            </span>
          </li>
          <li>
            <span>
              <strong>Deployed-instance fuzzing.</strong> Targets a contract at
              its real address and acts as real accounts on the fork.
            </span>
          </li>
          <li>
            <span>
              <strong>Arc Studio integration.</strong> Targets come from the
              builder&rsquo;s workspace through their token; the report and drafted
              fix come back.
            </span>
          </li>
          <li>
            <span>
              <strong>Campaign controls.</strong> A billing cap and a campaign
              journal per run. And it never asks for a signature at all.
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}

const controls: [string, "built" | "design" | "planned"][] = [
  ["Billing cap per campaign", "built"],
  ["Campaign journal: every plan, trace and verdict", "built"],
  ["Arc Studio-listed deployments only, in live mode", "built"],
  ["Findings returned only to the account that ran them", "built"],
  ["No signing, deployment or broadcast path", "design"],
  ["Per-user audit log", "planned"],
  ["Human review of findings before sharing", "planned"],
  ["Ownership check for pasted code and the CLI", "planned"],
];

function Facts() {
  return (
    <>
      <div className={styles.facts}>
        <div className={styles.fact}>
          <span>Fact 1 · Scope</span>
          <h4>Targets come from the builder</h4>
          <p>
            Targets are read from the user&rsquo;s own Arc Studio workspace through
            their token. In live mode the fuzzer uses only deployments Arc
            Studio lists for that account. Pasted-code and CLI modes have no
            proof-of-ownership check today; an ownership policy for them is on
            the roadmap.
          </p>
        </div>
        <div className={styles.fact}>
          <span>Fact 2 · Execution</span>
          <h4>Everything runs on a private fork</h4>
          <p>
            A held Arc fork pinned at one block installs the contract, or
            targets the deployed instance, funds the actors and runs every
            sequence. The fuzzer never signs, deploys or broadcasts. The wallet
            sign-in identifies the Aomi account; it is never asked to sign a
            transaction.
          </p>
        </div>
        <div className={styles.fact}>
          <span>Fact 3 · Judging</span>
          <h4>Code decides, not the model</h4>
          <p>
            A finding is reported only after its shortest failing sequence
            replays twice from baseline. Ideas the agent did not run are
            labelled as hypotheses. When nothing breaks, the report says which
            rules held within budget and which surfaces were not reached.
          </p>
        </div>
      </div>
      <ul className={styles.controls}>
        {controls.map(([control, state]) => (
          <li
            className={state === "planned" ? styles.planned : styles.built}
            key={control}
          >
            {control}
            <i>
              {state === "built"
                ? "Built"
                : state === "design"
                  ? "By design"
                  : "Planned"}
            </i>
          </li>
        ))}
      </ul>
    </>
  );
}

const roadmap = [
  [
    "Constructor support",
    "Installing compiled code skips the constructor today. Deployed-instance fuzzing already covers contracts live at a real address; this closes the gap for code that is not yet deployed.",
  ],
  [
    "First end-to-end run on a real Arc Studio app",
    "On a deployment the builder owns, with their permission. The result is reported as replayed evidence or as rules held within budget, never as safe.",
  ],
  [
    "Write-back to Arc Studio",
    "The agent already explains findings and drafts fixes. Next is sending the fix back and re-running the campaign to confirm it holds.",
  ],
  [
    "Per-user audit log and human review",
    "On top of the billing cap and campaign journal: a per-user log, and review of findings before they are shared.",
  ],
  [
    "Ownership checks beyond Arc Studio",
    "Live mode already uses only deployments Arc Studio lists for the account. Pasted code and the CLI get an ownership policy.",
  ],
  [
    "Design partners",
    "A small set of Arc Studio builders who run the fuzzer on their own apps and shape the report.",
  ],
];

function Roadmap() {
  return (
    <ol className={styles.roadmap}>
      {roadmap.map(([title, detail]) => (
        <li key={title}>
          <div>
            <strong>{title}</strong>
            <span>{detail}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const blocks: Record<string, () => React.JSX.Element> = {
  "::fuzzer-define::": Define,
  "::fuzzer-count::": Count,
  "::fuzzer-roles::": Roles,
  "::fuzzer-jobs::": Jobs,
  "::fuzzer-trace::": Trace,
  "::fuzzer-evidence::": Evidence,
  "::fuzzer-harness::": Harness,
  "::fuzzer-facts::": Facts,
  "::fuzzer-roadmap::": Roadmap,
};

export function AgenticFuzzerResearchBody({
  body,
  components,
}: {
  body: string;
  components: Components;
}) {
  return body.split(richBlockPattern).map((part, index) => {
    const Block = blocks[part];

    if (Block !== undefined) {
      return <Block key={part} />;
    }

    return (
      <ReactMarkdown
        components={components}
        key={`${index}-${part.slice(0, 24)}`}
        remarkPlugins={[remarkGfm]}
      >
        {part}
      </ReactMarkdown>
    );
  });
}
