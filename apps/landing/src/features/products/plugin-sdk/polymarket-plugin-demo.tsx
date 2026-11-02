import { useEffect, useState } from "react";
import { Check, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { resolveWidgetFixture } from "../widget/fixture-data";
import styles from "./plugin-sdk-marketing.module.css";

type DemoLine = {
  owner: "user" | "plugin" | "aomi" | "signer";
  label: string;
  detail: string;
  delay: number;
};

const [, fixture] = resolveWidgetFixture("prediction-yes");
const [marketStep, policyStep] = fixture.steps;

const demoLines: readonly DemoLine[] = [
  {
    owner: "user",
    label: "USER INTENT",
    detail: fixture.prompt,
    delay: 1100,
  },
  {
    owner: "plugin",
    label: "PLUGIN SDK · read_market",
    detail: `GET /markets/eth-5000 → YES ${marketStep.result.probability} · liquidity ${marketStep.result.liquidity}`,
    delay: 1200,
  },
  {
    owner: "plugin",
    label: "PLUGIN SDK · quote_order",
    detail: `GET /orderbook?outcome=YES → ${policyStep.result.shares} shares @ 62¢`,
    delay: 1150,
  },
  {
    owner: "aomi",
    label: "AOMI TX PIPELINE · CONSTRUCT",
    detail:
      "Resolve the market contract, outcome token, calldata, and exact $500 limit order.",
    delay: 1200,
  },
  {
    owner: "aomi",
    label: "AOMI TX PIPELINE · SIMULATE + GUARD",
    detail: `Fork passed · max loss ${policyStep.result.max_loss} · exposure policy passed`,
    delay: 1350,
  },
  {
    owner: "signer",
    label: "USER-OWNED SIGNER · SUBMIT",
    detail: "Order signed outside the model · submitted · receipt 0x8b…41",
    delay: 1600,
  },
] as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function ProductCube() {
  return (
    <svg
      className={styles.pluginCube}
      viewBox="0 0 160 176"
      role="img"
      aria-label="polymarket-trader plugin"
    >
      <polygon
        points="80,4 152,44 152,127 80,168 8,127 8,44"
        className={styles.pluginCubeBody}
      />
      <polygon
        points="80,4 152,44 80,85 8,44"
        className={styles.pluginCubeTop}
      />
      <polygon
        points="80,85 152,44 152,127 80,168"
        className={styles.pluginCubeSide}
      />
      <g className={styles.pluginCubeMark}>
        {[0, 1, 2].flatMap((row) =>
          [0, 1, 2].map((column) => (
            <circle
              key={`${row}-${column}`}
              cx={42 + column * 18}
              cy={101 + row * 18}
              r="6"
            />
          )),
        )}
      </g>
    </svg>
  );
}

export function PolymarketPluginDemo() {
  const [shown, setShown] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  const done = shown >= demoLines.length;

  useEffect(() => {
    if (reduced) {
      setShown(demoLines.length);
      return;
    }

    if (!playing) return;

    if (done) {
      const replayTimer = window.setTimeout(() => {
        setShown(1);
        setRun((value) => value + 1);
      }, 2600);
      return () => window.clearTimeout(replayTimer);
    }

    const timer = window.setTimeout(
      () => setShown((value) => value + 1),
      demoLines[shown - 1]?.delay ?? 1100,
    );
    return () => window.clearTimeout(timer);
  }, [done, playing, reduced, shown]);

  const pluginActive = shown >= 2 && shown < 4;
  const pipelineActive = shown >= 4;

  return (
    <div className={styles.pluginDemo} data-demo-step={shown}>
      <div className={styles.pluginDemoBody}>
        <section className={styles.pluginProduct}>
          <div className={styles.pluginIdentity}>
            <span className={pluginActive ? styles.pluginCubeLive : undefined}>
              <ProductCube />
            </span>
            <div>
              <p>PLUGIN SDK APP</p>
              <h2>polymarket-trader</h2>
              <span>user-owned market API + Aomi transaction namespace</span>
            </div>
          </div>

          <div className={styles.pluginEndpoints}>
            <span className={shown >= 2 ? styles.endpointLive : undefined}>
              <b>GET</b> /markets/:id
            </span>
            <span className={shown >= 3 ? styles.endpointLive : undefined}>
              <b>GET</b> /orderbook
            </span>
            <span className={pipelineActive ? styles.endpointLive : undefined}>
              <b>HOST</b> aomi.transactions
            </span>
          </div>

          <div className={styles.pluginBoundary}>
            <ShieldCheck aria-hidden />
            <span>
              <strong>Product API stays yours.</strong>
              Market context enters through typed Plugin SDK tools; signing
              authority never does.
            </span>
          </div>
        </section>

        <section className={styles.executionThread} aria-live="polite">
          <header>
            <div>
              <span>EXECUTION THREAD</span>
              <strong>{fixture.title}</strong>
            </div>
            <div className={styles.threadHeaderActions}>
              <span
                className={`${styles.threadStatus} ${done ? styles.threadReady : ""}`}
              >
                {done ? "CONFIRMED" : "RUNNING"}
              </span>
              <div className={styles.demoControls}>
                <button
                  type="button"
                  aria-label={playing ? "Pause demo" : "Play demo"}
                  onClick={() => setPlaying((value) => !value)}
                >
                  {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-label="Replay demo"
                  onClick={() => {
                    setShown(1);
                    setPlaying(true);
                    setRun((value) => value + 1);
                  }}
                >
                  <RotateCcw aria-hidden />
                </button>
              </div>
            </div>
          </header>

          <ol>
            {demoLines.slice(0, shown).map((line, index) => (
              <li
                key={`${run}-${index}`}
                className={styles[`thread_${line.owner}`]}
              >
                <span className={styles.threadMarker} aria-hidden>
                  {index < shown - 1 || done ? <Check /> : <i />}
                </span>
                <div>
                  <small>{line.label}</small>
                  <p>{line.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <footer>
            <span>
              plugin API
              <i aria-hidden />
              Aomi transaction pipeline
              <i aria-hidden />
              user-owned signer
            </span>
            <em>no live market, wallet, signer, or trade</em>
          </footer>
        </section>
      </div>
    </div>
  );
}
