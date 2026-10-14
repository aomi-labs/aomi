import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { MARKETING_ROOT } from "../../site";
import { BalanceTimeline, GateComparison } from "./payment-rails-charts";
import styles from "./payment-rails.module.css";

export const metadata: Metadata = {
  title: "Payment rails | Aomi",
  description:
    "How Aomi meters and settles agent turns: a running credit balance, a deferred pay gate checked every TURN_CAP turns, and the same accounting under both x402 and MPP.",
  robots: { index: false, follow: false },
};

export default function PaymentRailsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <Link to={`${MARKETING_ROOT}/pricing`} className={styles.back}>
            <ArrowLeft aria-hidden /> Pricing
          </Link>
          <p className={styles.eyebrow}>x402 payment processing</p>
          <h1>
            Deferred <em>credit gate</em>
          </h1>
          <p className={styles.sub}>
            Instead of verifying payment on <em>every</em> API turn, Aomi keeps
            a running credit balance and only re-checks it at a checkpoint every{" "}
            <em>TURN_CAP</em> turns. Between checkpoints the balance is allowed
            to run negative. Turns keep flowing, and the user is not billed each
            time.
          </p>
          <div className={styles.chips}>
            <span className={styles.chip}>
              credit<sub>0</sub> = <b>1</b>
            </span>
            <span className={styles.chip}>
              TURN_CAP = <b>3</b>
            </span>
            <span className={styles.chip}>
              cost / turn = <b>5</b>
            </span>
            <span className={styles.chip}>
              gate: <b>balance ≥ 0</b>
            </span>
          </div>
        </header>

        <section className={styles.section}>
          <h2>Running balance across turns</h2>
          <p className={styles.note}>
            The amber rail is the <b>pay gate</b>. A request clears only while{" "}
            <code>balance ≥ 0</code>, but the gate is only checked at a
            checkpoint, every <code>TURN_CAP</code> turns. Turns 2 and 3 ride
            through on credit, then the debt is caught when the gate shuts at
            turn 4.
          </p>
          <div className={styles.chartWrap}>
            <BalanceTimeline />
          </div>
          <div className={styles.legend}>
            <span>
              <i className={styles.bar} data-tone="gate" /> pay gate · request
              clears if balance ≥ 0
            </span>
            <span>
              <i className={styles.dot} data-tone="green" /> checkpoint · gate
              open, serve
            </span>
            <span>
              <i className={styles.dot} data-tone="grey" /> in-window turn · no
              check, serve on credit
            </span>
            <span>
              <i className={styles.dot} data-tone="red" /> checkpoint · gate
              shut, 402
            </span>
            <span>
              <i className={styles.dot} data-tone="blue" /> balance trajectory ·
              a top-up lifts it back through
            </span>
          </div>
        </section>

        <section className={styles.section}>
          <h2>The gate logic, per turn</h2>
          <p className={styles.note}>
            Most turns take the fast path, with no balance check and no billing
            event. Only every <code>TURN_CAP</code>-th turn actually settles.
          </p>
          <div className={styles.flow}>
            <div className={styles.node}>
              <div className={styles.nodeTitle}>
                Turn <span className={styles.mono}>N</span> arrives
              </div>
              <div className={styles.nodeDetail}>
                deduct cost from balance: <code>balance -= 5</code>
              </div>
            </div>
            <div className={styles.arrow}>↓</div>
            <div className={`${styles.node} ${styles.decision}`}>
              <div className={styles.nodeTitle}>
                Checkpoint?{" "}
                <span className={styles.mono}>
                  turns_since_check ≥ TURN_CAP
                </span>
              </div>
              <div className={styles.nodeDetail}>
                counts turns since the last settle
              </div>
            </div>
            <div className={styles.branch}>
              <div className={styles.lane}>
                <span className={styles.tagNo}>No → fast path</span>
                <div className={`${styles.node} ${styles.pass}`}>
                  <div className={styles.nodeTitle}>Serve immediately</div>
                  <div className={styles.nodeDetail}>
                    no check, no billing. The balance may go negative, and that
                    is allowed.
                  </div>
                </div>
              </div>
              <div className={styles.lane}>
                <span className={styles.tagYes}>Yes → settle</span>
                <div className={`${styles.node} ${styles.decision}`}>
                  <div className={styles.nodeTitle}>balance ≥ 0 ?</div>
                </div>
                <div className={`${styles.node} ${styles.pass}`}>
                  <div className={styles.nodeTitle}>
                    <span className={styles.pill}>≥ 0</span> Serve and reset the
                    counter
                  </div>
                  <div className={styles.nodeDetail}>
                    debt cleared by prior credit or top-ups
                  </div>
                </div>
                <div className={`${styles.node} ${styles.fail}`}>
                  <div className={styles.nodeTitle}>
                    <span className={styles.pillRed}>&lt; 0</span> Reject →{" "}
                    <code>HTTP 402 Payment Required</code>
                  </div>
                  <div className={styles.nodeDetail}>
                    the user tops up, balance returns to ≥ 0, and the retry
                    succeeds
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>What TURN_CAP buys you</h2>
          <p className={styles.note}>
            <b>Normal x402</b> gates every request. Aomi defers the gate to once
            every <code>TURN_CAP</code> turns, which is the same check, just
            amortized. The difference over 6 turns:
          </p>
          <div className={styles.chartWrap}>
            <GateComparison />
          </div>
          <div className={styles.legend}>
            <span>
              <i className={styles.bar} data-tone="gate" /> gate check, a 402
              pre-check
            </span>
            <span>
              <i className={styles.dot} data-tone="gate" /> settlement or
              billing event
            </span>
            <span>
              <i className={styles.dot} data-tone="green" /> fast path · no
              check, no bill
            </span>
          </div>
          <div className={styles.cards}>
            <article className={`${styles.card} ${styles.strict}`}>
              <span className={`${styles.badge} ${styles.badgeStrict}`}>
                per-request
              </span>
              <h3>Normal x402</h3>
              <p className={styles.lead}>Gate on every call.</p>
              <ul>
                <li>
                  Balance checked before every turn, the classic per-request 402
                  gate.
                </li>
                <li>
                  A settlement or billing event fires every turn, so it is
                  chattier and slower.
                </li>
                <li>
                  Zero credit exposure, since a request never runs while below
                  zero.
                </li>
              </ul>
            </article>
            <article className={`${styles.card} ${styles.relaxed}`}>
              <span className={`${styles.badge} ${styles.badgeRelaxed}`}>
                deferred · CAP 3
              </span>
              <h3>The deferred gate</h3>
              <p className={styles.lead}>Gate once per TURN_CAP.</p>
              <ul>
                <li>
                  2 of 3 turns skip the gate, so there are fewer round-trips,
                  fewer bills, and less latency.
                </li>
                <li>
                  The balance may run negative between checkpoints, and it is
                  caught at the next gate.
                </li>
                <li>
                  Even a user starting at <code>0</code> flows. Set{" "}
                  <code>CAP=1</code> to recover strict x402.
                </li>
              </ul>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <h2>x402 and MPP: same accounting, different gate position</h2>
          <p className={styles.note}>
            The credit and turn-cap bookkeeping is agnostic. The two variants
            differ only in <em>when</em> the balance check runs relative to the
            API call.
          </p>
          <div className={styles.cards}>
            <article className={`${styles.card} ${styles.x402}`}>
              <span className={`${styles.badge} ${styles.badgeX402}`}>
                x402
              </span>
              <h3>Pre-check gate</h3>
              <p className={styles.lead}>
                Verify <em>before</em> serving.
              </p>
              <ul>
                <li>
                  The check runs <b>ahead of</b> the API call at each
                  checkpoint.
                </li>
                <li>
                  Fails closed, so <code>402 Payment Required</code> blocks the
                  call.
                </li>
                <li>
                  Payment headers are negotiated up front, then the response is
                  served.
                </li>
              </ul>
            </article>
            <article className={`${styles.card} ${styles.mpp}`}>
              <span className={`${styles.badge} ${styles.badgeMpp}`}>MPP</span>
              <h3>Post-check settle</h3>
              <p className={styles.lead}>
                Verify <em>after</em> serving.
              </p>
              <ul>
                <li>
                  The API call runs first, and the balance check happens{" "}
                  <b>after</b>.
                </li>
                <li>Serve then settle, reconciling on the trailing edge.</li>
                <li>
                  The same running balance and TURN_CAP math underneath.
                </li>
              </ul>
            </article>
          </div>
        </section>

        <div className={styles.foot}>
          <span className={styles.ok}>✓</span>
          <span>
            Payment-header plumbing is shared across both variants, so the gate
            is <b>x402 and MPP agnostic</b>. Swapping variant only moves the
            check from before the call to after it.
          </span>
        </div>

        <div className={styles.backRow}>
          <Link to={`${MARKETING_ROOT}/pricing`}>
            <ArrowLeft aria-hidden /> Back to pricing
          </Link>
        </div>
      </div>
    </main>
  );
}
