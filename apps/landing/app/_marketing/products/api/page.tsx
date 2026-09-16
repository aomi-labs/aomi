import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  Waypoints,
} from "lucide-react";
import { ActionSummaryShowcase } from "./action-summary-showcase";
import { ApiWorkbench } from "./api-workbench";
import { ClientExample } from "./client-example";
import styles from "./rest-api.module.css";

export const metadata: Metadata = {
  title: "REST APIs | Aomi",
  description:
    "Natural language in, signable transactions out. Use Aomi's Agent API or guarded Pipeline API without giving up custody.",
  robots: { index: false, follow: false },
};

const lifecycle = [
  {
    number: "01",
    title: "Plan",
    body: "Resolve an intent or accept the exact catalog action your strategy selected.",
  },
  {
    number: "02",
    title: "Simulate",
    body: "Run the complete batch against a fork before anything reaches a signer.",
  },
  {
    number: "03",
    title: "Guard",
    body: "Enforce chain, signer, ordering, slippage, and application policy.",
  },
  {
    number: "04",
    title: "Sign",
    body: "Return a sealed action to the wallet adapter your product already trusts.",
  },
  {
    number: "05",
    title: "Verify",
    body: "Observe the transaction and verify it against the action before resuming.",
  },
] as const;

const sharedPipelineStages = [
  {
    number: "01",
    title: "Plan",
    body: "Resolve the customer's intent or accept the exact action and batch the integrator selected.",
    guarantee: "Actions survive the turn",
    guaranteeBody:
      "The resulting Action is durable and recoverable across clients.",
  },
  {
    number: "02",
    title: "Simulate",
    body: "Run the complete batch against a fork before anything reaches a signer.",
    guarantee: "Simulated before sealed",
    guaranteeBody:
      "The verdict and ordered balance changes travel with the Action.",
  },
  {
    number: "03",
    title: "Guard",
    body: "Enforce chain, signer, ordering, slippage, and application policy.",
    guarantee: "Errors fail closed",
    guaranteeBody:
      "Typed failures explain the next step without widening authority.",
  },
  {
    number: "04",
    title: "Sign",
    body: "Return a sealed Action to the wallet adapter the product already trusts.",
    guarantee: "We never hold keys",
    guaranteeBody:
      "The integrator's signer remains the authority for every signature.",
  },
  {
    number: "05",
    title: "Verify",
    body: "Observe the transaction and check it against the sealed Action before resuming.",
    guarantee: "A hash is not proof",
    guaranteeBody:
      "Signer, chain, calldata, ordering, and fee legs are checked onchain.",
  },
] as const;

const guarantees = [
  {
    icon: KeyRound,
    title: "We never hold keys",
    body: "Every guest signature comes from the integrator's signer. Custody is never inferred from a wallet address.",
  },
  {
    icon: ShieldCheck,
    title: "Simulated before sealed",
    body: "The action carries its simulation result and guard verdict into the approval boundary.",
  },
  {
    icon: CheckCircle2,
    title: "A hash is not proof",
    body: "Reported transactions are fetched and checked against signer, chain, calldata, ordering, and fee legs.",
  },
  {
    icon: RefreshCw,
    title: "Exactly-once resume",
    body: "Idempotent results and ordered state transitions prevent duplicate execution or double resume.",
  },
  {
    icon: Activity,
    title: "Actions survive the turn",
    body: "Pending actions remain recoverable after refresh, across clients, and through deferred signing.",
  },
  {
    icon: LockKeyhole,
    title: "Errors fail closed",
    body: "Public errors expose what the caller should do next without leaking private applications or wallet ownership.",
  },
] as const;

const sdkExample = `import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi({
  baseUrl: "https://chat.aomi.dev",
});

const run = aomi.agent.run(
  "Move my USDC into the best yield on Base",
  { app: "aomi" },
);

run.on("action", (action) => renderApproval(action));
const result = await run.result();
console.log(result.sessionId, result.actions);`;

const curlExample = `curl https://chat.aomi.dev/v1/agent/chat \\
  -H "Authorization: Bearer $AOMI_TOKEN" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{ "message": "Move idle USDC into the best yield on Base",
        "app": "aomi",
        "userState": { "evm": { "address": "0xAb5…", "chain_id": 8453 } } }'

# → 200 { "session_id": "sess_…", "cursor": "cur_…",
#         "events": […], "has_more": false }`;

const integrationLedger = [
  {
    label: "Authentication",
    value:
      "OAuth 2.1 access tokens (PKCE, device code, or SIWE/SIWS). Guest capability lane for attended signing, claimable into an account later.",
  },
  {
    label: "Fail closed",
    value:
      "A present-but-invalid credential is always 401; it never downgrades to guest. Missing scope is 403.",
  },
  {
    label: "Idempotency",
    value:
      "Idempotency-Key on every mutating call. Same key + same body returns the recorded response; a different body is 409.",
  },
  {
    label: "Concurrency",
    value:
      "One turn per session. A second request during an active turn returns 409 busy with the live cursor.",
  },
  {
    label: "Custody models",
    value:
      "Browser and embedded wallets sign in-band. Safe, Turnkey, and policy custody return deferred; the action waits for quorum.",
  },
  {
    label: "Verification",
    value:
      "A reported hash enters submitted_unverified. A watcher checks signer, chain, calldata, ordering, and fee legs before confirmed.",
  },
  {
    label: "Recovery",
    value:
      "Unresolved actions appear in every delta regardless of cursor. Refresh, crash, or second device—nothing is lost.",
  },
  {
    label: "Errors",
    value:
      "Typed JSON errors with a retryable flag: invalid_auth, insufficient_scope, quota_exhausted, action_superseded, transaction_mismatch…",
  },
] as const;

export default function RestApiProductPage({
  humanInterfaceHref = "/products/widget",
  pluginSdkHref = "/products/plugin-sdk",
  useMarketingLayout = false,
}: {
  humanInterfaceHref?: string;
  pluginSdkHref?: string;
  useMarketingLayout?: boolean;
} = {}) {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>AOMI REST APIs</p>
            <h1>Onchain execution, as a REST API.</h1>
            <p className={styles.heroSupport}>
              Add swaps, yield, transfers, and settlement to an existing product
              with one JSON API. Aomi plans, fork-simulates, and policy-checks
              every transaction; the customer&apos;s wallet signs. No custody,
              no new signing stack.
            </p>
            <div className={styles.heroActions}>
              <a
                href="https://aomi.dev/docs/"
                target="_blank"
                rel="noreferrer"
                className={styles.primaryButton}
              >
                View the API reference
                <ArrowUpRight aria-hidden />
              </a>
              <Link href="#integration" className={styles.secondaryButton}>
                Integration checklist
                <ArrowRight aria-hidden />
              </Link>
            </div>
            <p className={styles.heroNote}>
              REST + JSON · OAuth 2.1 or guest · EVM + Solana · keys stay with
              your signer
            </p>
          </div>

          {!useMarketingLayout && <ApiWorkbench />}
        </div>
      </section>

      <section className={styles.proofRail} aria-label="REST API facts">
        <div className={styles.shell}>
          <div>
            <span>Contract</span>
            <strong>v1 · additive-only</strong>
          </div>
          <div>
            <span>Idempotency</span>
            <strong>Every mutating call</strong>
          </div>
          <div>
            <span>Networks</span>
            <strong>EVM + Solana</strong>
          </div>
          <div>
            <span>Keys held by Aomi</span>
            <strong>Zero</strong>
          </div>
        </div>
      </section>

      <section id="apis" className={styles.apiSection}>
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>TWO PORTS, ONE KERNEL</p>
              <h2>Choose who plans.</h2>
            </div>
            <p>
              Both APIs end at the same execution boundary. The difference is
              whether Aomi resolves a customer&apos;s intent or the platform
              submits the exact action its own systems selected.
            </p>
          </div>

          <div className={styles.apiCards}>
            <article className={styles.apiCard}>
              <div className={styles.apiCardTopline}>
                <span className={styles.apiIcon}>
                  <Bot aria-hidden />
                </span>
                <span className={styles.contractBadge}>V1 CONTRACT</span>
              </div>
              <p className={styles.apiIndex}>01 · AOMI RESOLVES THE INTENT</p>
              <h3>Agent API</h3>
              <p className={styles.apiCardBody}>
                Send a user&apos;s intent and wallet capabilities. Receive
                messages, activity, and a durable action that can be approved by
                the signer already inside your product.
              </p>
              <div className={styles.endpointList}>
                <span>
                  <b>POST</b> /v1/agent/chat
                </span>
                <span>
                  <b>GET</b> /v1/agent/chat/{`{session}`}
                </span>
                <span>
                  <b>POST</b> .../actions/{`{action}`}/result
                </span>
              </div>
              <div className={styles.bestFor}>
                <span>BEST FOR</span>
                <strong>Wallets, neobanks, and conversational products</strong>
              </div>
              <p className={styles.proofLine}>
                <span>IN PRODUCTION</span>
                Sommelier&apos;s liquidity assistant runs on this path.
              </p>
            </article>

            <article className={`${styles.apiCard} ${styles.pipelineCard}`}>
              <div className={styles.apiCardTopline}>
                <span className={`${styles.apiIcon} ${styles.pipelineIcon}`}>
                  <Waypoints aria-hidden />
                </span>
                <span className={styles.contractBadge}>V1 CONTRACT</span>
              </div>
              <p className={styles.apiIndex}>
                02 · YOUR SYSTEM SELECTS THE ACTION
              </p>
              <h3>Pipeline API</h3>
              <p className={styles.apiCardBody}>
                Select a catalog operation or assemble a batch directly. Receive
                a portable Build with ordered actions, simulation evidence, and
                a stable digest—with no chat session.
              </p>
              <div className={styles.endpointList}>
                <span>
                  <b>POST</b> /v1/pipeline/evm/build
                </span>
                <span>
                  <b>POST</b> /v1/pipeline/svm/build
                </span>
                <span>
                  <b>POST</b> .../{`{stage,simulate,commit}`}
                </span>
              </div>
              <div className={styles.bestFor}>
                <span>BEST FOR</span>
                <strong>
                  Trading platforms, treasuries, and existing order flow
                </strong>
              </div>
              <p className={styles.proofLine}>
                <span>IN PRODUCTION</span>
                World Markets&apos; Telegram trading agent keeps its own
                strategy and submits through this path.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.contractSection}>
        <div className={styles.shell}>
          <div className={styles.contractCopy}>
            <p className={styles.eyebrow}>THE SHARED CONTRACT</p>
            <h2>Both APIs can reach the same Action boundary.</h2>
            <p>
              Agent chat emits Actions in its event log. Pipeline commit returns
              an Action when wallet approval is required. One confirmation UI
              can render the same request union from either path.
            </p>
            <ul>
              <li>
                <Check aria-hidden /> Typed Action request union
              </li>
              <li>
                <Check aria-hidden /> EVM and SVM execution envelopes
              </li>
              <li>
                <Check aria-hidden /> Revisioned, recoverable lifecycle
              </li>
            </ul>
          </div>

          {useMarketingLayout ? (
            <ActionSummaryShowcase />
          ) : (
            <div className={styles.contractVisual}>
              <div className={styles.contractPorts}>
                <span>
                  <Bot aria-hidden /> Agent event
                </span>
                <span>
                  <Braces aria-hidden /> Pipeline commit
                </span>
              </div>
              <div className={styles.contractLines} aria-hidden>
                <i />
                <i />
              </div>
              <article className={styles.summaryCard}>
                <div className={styles.summaryTopline}>
                  <span>ACTION SUMMARY</span>
                  <span>act_8f2…</span>
                </div>
                <h3>Swap 0.5 ETH for ~1,240 USDC</h3>
                <div className={styles.summarySteps}>
                  <div>
                    <span>01</span>
                    <p>
                      <strong>Swap through Uniswap v3</strong>
                      <small>0.5 ETH out · ~1,240 USDC in</small>
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>
                      <strong>Settle to your wallet</strong>
                      <small>Base · minimum received enforced</small>
                    </p>
                  </div>
                </div>
                <div className={styles.summaryMeta}>
                  <span>
                    GAS <b>Sponsored</b>
                  </span>
                  <span>
                    WARNINGS <b>None</b>
                  </span>
                </div>
              </article>
              <p className={styles.sealedNote}>
                <ShieldCheck aria-hidden /> Summary and payload sealed together
              </p>
            </div>
          )}
        </div>
      </section>

      {useMarketingLayout ? (
        <section className={styles.sharedPipelineSection}>
          <div className={styles.shell}>
            <div className={styles.sharedPipelineHeading}>
              <div>
                <p className={styles.eyebrow}>
                  TWO APIS · ONE TRANSACTION PIPELINE
                </p>
                <h2>More control. The same execution lifecycle.</h2>
              </div>
              <p>
                The Agent API accepts customer intent and lets Aomi plan. The
                Pipeline API accepts the exact operation or batch your own
                agent, strategy, or product selected. Its portable Build crosses
                simulation before commit; commit returns an Action when a wallet
                must finish the work.
              </p>
            </div>

            <div className={styles.pipelineEntries}>
              <article>
                <div>
                  <Bot aria-hidden />
                  <span>AGENT API · AOMI PLANS</span>
                </div>
                <h3>Send intent.</h3>
                <p>
                  Aomi runs the agent loop, selects tools, and turns the
                  conversation into a durable Action.
                </p>
                <code>message + wallet capabilities</code>
              </article>
              <article>
                <div>
                  <Waypoints aria-hidden />
                  <span>PIPELINE API · YOU PLAN</span>
                </div>
                <h3>Send the action.</h3>
                <p>
                  Keep your own model, strategy, and routing logic. Submit one
                  catalog action or an ordered batch directly.
                </p>
                <code>PipelineOperationBuildInput</code>
              </article>
            </div>

            <div className={styles.sharedActionBand}>
              <span>
                Both surfaces can hand the same Action union to a signer
              </span>
              <strong>
                One confirmation UI · one wallet binding · one evidence trail
              </strong>
            </div>

            <ol className={styles.sharedPipelineGrid}>
              {sharedPipelineStages.map((step) => (
                <li key={step.number}>
                  <span>{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div>
                    <strong>{step.guarantee}</strong>
                    <small>{step.guaranteeBody}</small>
                  </div>
                </li>
              ))}
            </ol>

            <div className={styles.resumeGuarantee}>
              <RefreshCw aria-hidden />
              <span>ACROSS THE WHOLE LIFECYCLE</span>
              <strong>Exactly-once resume</strong>
              <p>
                Idempotent results and ordered state transitions make retries
                safe without duplicate execution or double-resuming a thread.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.lifecycleSection}>
          <div className={styles.shell}>
            <div className={styles.lifecycleHeading}>
              <p className={styles.eyebrow}>THE GUARDED LIFECYCLE</p>
              <h2>More than encode and simulate.</h2>
              <p>
                Every surface runs through the same enforcement path used by
                Aomi&apos;s own product.
              </p>
            </div>
            <ol className={styles.lifecycleGrid}>
              {lifecycle.map((step) => (
                <li key={step.number}>
                  <span>{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className={styles.harnessLoopSection}>
        <div className={styles.shell}>
          <div className={styles.sharedPipelineHeading}>
            <div>
              <p className={styles.eyebrow}>INSIDE THE HARNESS</p>
              <h2>
                An API-exposed transaction pipeline, on a harness that mutates
                world state.
              </h2>
            </div>
            <p>
              Fundamentally, every harness that takes actions is mutating the
              state of the world its agent lives in — whether that world is a
              codebase, a file system, or a financial ledger. Aomi exposes that
              loop as an API: a typed action over a mutable world, judged by the
              world&apos;s end-state. Onchain, the world diverges at five points
              — a typed, gated action space, simulation as the only rehearsal,
              no unilateral write authority, irreversibility, and a shared,
              adversarial world.
            </p>
          </div>
          <figure className={styles.harnessLoopFigure}>
            <img
              src="/research/aomibench-v0.1/figures/f02_coding_vs_aomi.svg"
              alt="Diagram comparing a coding harness loop with the Aomi harness loop. Both run intent, read, stage, verify, commit, and verify-result steps; the Aomi side marks five divergences: a typed gated tool surface, dry-run simulation as the only safe rehearsal, no harness write authority, irreversibility, and a shared adversarial world."
              loading="lazy"
            />
            <figcaption>
              From{" "}
              <Link href="/research/aomibench-v0-1">
                AomiBench: benchmarking frontier models on onchain execution
              </Link>
            </figcaption>
          </figure>
        </div>
      </section>

      {!useMarketingLayout && (
        <section className={styles.sdkSection}>
          <div className={styles.shell}>
            <ClientExample sdkExample={sdkExample} curlExample={curlExample} />
            <div className={styles.sdkCopy}>
              <p className={styles.eyebrow}>PLAIN HTTP, OR THE CLIENT</p>
              <h2>Integrate from any stack.</h2>
              <p>
                The API is plain JSON over HTTPS—call it from the backend
                language already in production. Teams shipping in TypeScript can
                use the client, which manages sessions, cursors, retries, and
                idempotency while keeping Action approval explicit.
              </p>
              <div className={styles.adapterRow}>
                <span>
                  <WalletCards aria-hidden /> wagmi
                </span>
                <span>Para</span>
                <span>Privy</span>
                <span>Safe</span>
                <span>Turnkey</span>
              </div>
              <a
                href="https://aomi.dev/docs/"
                target="_blank"
                rel="noreferrer"
                className={styles.textLink}
              >
                Explore the client surface
                <ArrowUpRight aria-hidden />
              </a>
            </div>
          </div>
        </section>
      )}

      <section id="integration" className={styles.ledgerSection}>
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>INTEGRATION CHECKLIST</p>
              <h2>The questions engineering asks first.</h2>
            </div>
            <p>
              Answers from the v1 reference, in the order an integration review
              reaches them.
            </p>
          </div>
          <dl className={styles.ledger}>
            {integrationLedger.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {!useMarketingLayout && (
        <section className={styles.guaranteeSection}>
          <div className={styles.shell}>
            <div className={styles.guaranteeHeading}>
              <p className={styles.eyebrow}>CONTRACT GUARANTEES</p>
              <h2>Safe to retry. Hard to misrepresent.</h2>
            </div>
            <div className={styles.guaranteeGrid}>
              {guarantees.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title}>
                    <Icon aria-hidden />
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className={styles.finalCta}>
        <div className={styles.shell}>
          <div>
            <p className={styles.eyebrow}>BUILD ON THE KERNEL</p>
            <h2>Start with intent. Drop down to precision when you need it.</h2>
            <p className={styles.finalBridge}>
              Integrating into an existing product? Start here. Want Aomi to
              host the agent and the customer-facing surface too? See the{" "}
              <Link href={humanInterfaceHref}>Human Interface</Link> and{" "}
              <Link href={pluginSdkHref}>Plugin SDK</Link>—the same signer can
              remain in control across every surface.
            </p>
          </div>
          <div className={styles.finalActions}>
            <a
              href="https://aomi.dev/docs/"
              target="_blank"
              rel="noreferrer"
              className={styles.finalPrimary}
            >
              Read API documentation
              <ArrowUpRight aria-hidden />
            </a>
            <Link href="../contact" className={styles.finalSecondary}>
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
