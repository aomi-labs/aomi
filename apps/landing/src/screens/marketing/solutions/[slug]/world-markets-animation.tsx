"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./world-markets-animation.module.css";

const sceneDurations = [3700, 4400, 4100, 4500, 3700, 3600] as const;
const totalDuration = sceneDurations.reduce(
  (total, duration) => total + duration,
  0,
);

declare global {
  interface Window {
    __AOMI_VIDEO__?: {
      duration: number;
      seek: (seconds: number) => void;
      play: () => void;
      pause: () => void;
    };
    __AOMI_VIDEO_READY__?: boolean;
  }
}

function sceneAt(elapsed: number) {
  let boundary = 0;
  for (let index = 0; index < sceneDurations.length; index += 1) {
    boundary += sceneDurations[index];
    if (elapsed < boundary) return index;
  }
  return 0;
}

function WorldMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <path
        fill={inverse ? "#fff" : "#050505"}
        d="M192 0a48 48 0 0 1 34 14l60 60a48 48 0 0 1 14 34v84q0 20-14 34l-60 60a48 48 0 0 1-34 14h-84q-20 0-34-14l-60-60a48 48 0 0 1-14-34v-84a48 48 0 0 1 14-34l60-60a48 48 0 0 1 34-14zm-30 276h13l35-63a38 38 0 0 0 5-19v-32h-53zm-77-82a38 38 0 0 0 5 19l35 63h13V162H85zm-61-2a24 24 0 0 0 7 17l60 60 5 4-27-49a62 62 0 0 1-8-30v-32H24zm215 2a62 62 0 0 1-8 30l-27 49 5-4 60-60a24 24 0 0 0 7-17v-30h-37zM96 27l-5 4-60 60a24 24 0 0 0-7 17v30h37v-32q0-16 8-30zm66 111h53v-32a38 38 0 0 0-5-19l-35-63h-13zm69-62a62 62 0 0 1 8 30v32h37v-30a24 24 0 0 0-7-17l-60-60-5-4zM90 87a38 38 0 0 0-5 19v32h53V24h-13z"
      />
    </svg>
  );
}

function AomiMark() {
  return (
    <svg viewBox="0 0 362 362" aria-hidden="true">
      <path d="M321.778 94.235c0-29.831-24.183-54.013-54.013-54.013s-54.013 24.182-54.013 54.013 24.183 54.013 54.013 54.013 54.013-24.182 54.013-54.013ZM362 94.235c0 52.044-42.19 94.235-94.235 94.235s-94.235-42.191-94.235-94.235S215.721 0 267.765 0 362 42.19 362 94.235Z" />
      <path d="M181 0c3.792 0 7.556.116 11.289.346-2.783 2.399-5.456 4.923-8.009 7.564-13.283 12.849-23.611 28.735-29.86 46.541C95.768 66.708 51.714 118.709 51.714 181c0 71.403 57.883 129.286 129.286 129.286 62.292 0 114.291-44.055 126.547-102.706 17.817-6.253 33.712-16.59 46.566-29.885 2.632-2.546 5.148-5.209 7.54-7.985.23 3.734.347 7.498.347 11.29 0 99.964-81.036 181-181 181S0 280.964 0 181 81.036 0 181 0Z" />
    </svg>
  );
}

function TelegramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 0a12 12 0 1 0 0 24 12 12 0 1 0 0-24m5 7.2.4.2.1.3v.5c-.1 1.9-.9 6.5-1.3 8.6q-.3 1.3-.8 1.2-1 0-2-.9l-2.6-1.8c-1.2-.8-.4-1.2.3-1.9l3.3-3.2V10H14q-.2 0-5.1 3.3-.7.5-1.3.5l-1.9-.5q-1.2-.2-1.3-.8 0-.3 1-.6l7-3z"
      />
    </svg>
  );
}

function BrandBar() {
  return (
    <div className={styles.brandBar}>
      <div className={styles.lockup}>
        <WorldMark />
        <strong>World Markets</strong>
        <span>×</span>
        <AomiMark />
        <b>aomi</b>
      </div>
      <div className={styles.preview}>Product integration preview</div>
    </div>
  );
}

function SceneCopy({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.sceneCopy}>
      <p>{eyebrow}</p>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function HookScene() {
  return (
    <div className={styles.hookLayout}>
      <SceneCopy
        eyebrow="The World trading agent on Telegram"
        title={
          <>
            Trade on World
            <br />
            from Telegram.
          </>
        }
      >
        Tell the agent what you want to trade. Aomi prepares the action, and
        World keeps control onchain.
      </SceneCopy>
      <div className={styles.orbit}>
        <div />
        <span className={styles.orbitWorld}>
          <WorldMark inverse />
        </span>
        <span className={styles.orbitTelegram}>
          <TelegramMark />
        </span>
        <i />
      </div>
    </div>
  );
}

function ConnectScene() {
  return (
    <div className={styles.connectLayout}>
      <div className={styles.marketPanel}>
        <header>
          <span>
            <i>
              <WorldMark />
            </i>
            <strong>WETH-PERP</strong>
            <small>MegaETH</small>
          </span>
          <b>3,482.18</b>
        </header>
        <svg
          viewBox="0 0 652 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="world-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#19df19" stopOpacity=".26" />
              <stop offset="1" stopColor="#19df19" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className={styles.chartGrid}>
            <path d="M0 40H652M0 100H652M0 160H652M0 220H652" />
            <path d="M80 0V240M200 0V240M320 0V240M440 0V240M560 0V240" />
          </g>
          <path
            className={styles.chartArea}
            d="M0 203 C40 195 58 178 92 182 S150 160 180 169 S246 137 284 144 S334 113 368 124 S431 96 468 110 S528 71 560 78 S615 44 652 51 L652 240 L0 240Z"
            fill="url(#world-area)"
          />
          <path
            className={styles.chartLine}
            d="M0 203 C40 195 58 178 92 182 S150 160 180 169 S246 137 284 144 S334 113 368 124 S431 96 468 110 S528 71 560 78 S615 44 652 51"
          />
        </svg>
        <dl>
          <div>
            <dt>Position</dt>
            <dd>Long WETH</dd>
          </div>
          <div>
            <dt>Margin state</dt>
            <dd>Healthy</dd>
          </div>
          <div>
            <dt>Open orders</dt>
            <dd>2</dd>
          </div>
        </dl>
      </div>

      <div className={styles.connectCard}>
        <p>Connect World to Telegram</p>
        <h3>Connect your world account.</h3>
        <img
          src="/assets/landing/case-studies/world-markets/telegram-world-handoff-qr.svg"
          alt="QR code opening the World Markets Telegram bot"
        />
        <strong>
          <TelegramMark /> @world_trading_bot
        </strong>
        <span>QR valid for 90 seconds</span>
        <small>No balances, positions, or authority in the link.</small>
      </div>
    </div>
  );
}

function TelegramScene() {
  return (
    <div className={styles.telegramLayout}>
      <SceneCopy
        eyebrow="Ask the World agent"
        title="Tell the agent what you want to trade."
      >
        Aomi combines the instruction with live World account and market state,
        then prepares a structured action for review or submission.
      </SceneCopy>

      <div className={styles.phone}>
        <header>
          <span>‹</span>
          <i>
            <WorldMark inverse />
          </i>
          <div>
            <strong>World&apos;s Agent</strong>
            <small>bot</small>
          </div>
          <span>⌕</span>
          <span>⋮</span>
        </header>
        <div className={styles.chat}>
          <small>Today</small>
          <div className={styles.userMessage}>
            Buy 0.5 WETH at 3,420 with a limit order.
            <time>10:42 ✓✓</time>
          </div>
          <div className={styles.agentRow}>
            <i>
              <WorldMark inverse />
            </i>
            <div>
              <div className={styles.agentMessage}>
                <strong>Limit order prepared.</strong>I loaded your selected
                World account and current WETH-PERP state. World&apos;s contract
                checks apply before submission.
                <time>10:42</time>
              </div>
              <span>Review order · Buy 0.5 WETH at 3,420</span>
              <span>Open exact World state ↗</span>
            </div>
          </div>
        </div>
        <footer>
          <b>☰ Menu</b>
          <span>Message</span>
          <i>●</i>
        </footer>
      </div>
    </div>
  );
}

function SecurityScene() {
  const nodes = [
    ["Owner's World grant", "trade-only and revocable", "✓"],
    ["Aomi action", "structured trade request", "✦"],
    ["Action rejected", "when a contract check fails", "×"],
    ["Action accepted", "onchain order and receipt", "✓"],
  ] as const;

  return (
    <div className={styles.securityLayout}>
      <SceneCopy
        eyebrow="The security model"
        title={
          <>
            The agent can trade,
            <br />
            not withdraw.
          </>
        }
      >
        The owner grants an Aomi address trade-only access to one World account,
        keeps withdrawal authority, and can revoke the address onchain.
      </SceneCopy>
      <div className={styles.securityDiagram}>
        {nodes.map(([title, body, icon], index) => (
          <div
            key={title}
            className={styles.securityNode}
            data-node={index + 1}
          >
            <i>{icon}</i>
            <span>
              <strong>{title}</strong>
              <small>{body}</small>
            </span>
          </div>
        ))}
        <div className={styles.contractNode}>
          <small>World contracts</small>
          <strong>Permission + ATLAS risk</strong>
        </div>
        <svg
          viewBox="0 0 580 455"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="contract-arrow"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto"
            >
              <path d="M0 0L9 4.5L0 9Z" fill="#9ba2ac" />
            </marker>
          </defs>
          <path d="M198 64 C248 64 250 160 270 183" />
          <path d="M382 64 C332 64 330 160 310 183" />
          <path d="M238 273 C218 308 180 317 140 340" />
          <path d="M342 273 C362 308 400 317 440 340" />
        </svg>
        <b className={styles.denyStamp}>Can say no</b>
      </div>
    </div>
  );
}

function MandateScene() {
  const rules = [
    ["Account scope", "Dedicated World subaccount"],
    ["Delegated authority", "Trading actions only"],
    ["Withdrawal authority", "Retained by the owner"],
    ["Portfolio risk", "Enforced onchain by ATLAS"],
  ] as const;

  return (
    <div className={styles.mandateLayout}>
      <SceneCopy
        eyebrow="What makes the product work"
        title="The onchain mandate defines the agent's authority."
      >
        Smart-contract-enforced policies bound account scope, trade-only
        authorization, owner revocation, and World&apos;s portfolio-risk checks.
      </SceneCopy>
      <div className={styles.mandatePanel}>
        <header>
          <div>
            <small>World account controls</small>
            <strong>Delegated Aomi Trader</strong>
          </div>
          <span>Authorized onchain</span>
        </header>
        <div className={styles.ruleGrid}>
          {rules.map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className={styles.enforcementResult}>
          <span>
            <small>Enforcement result</small>
            <strong>
              Every submitted action remains subject to World&apos;s contract
              checks.
            </strong>
          </span>
          <b>✓</b>
        </div>
        <footer>
          Current app release: preview-only. Live execution is not claimed.
        </footer>
      </div>
    </div>
  );
}

function CloseScene() {
  return (
    <div className={styles.closeScene}>
      <p>World Markets × Aomi</p>
      <h3>Telegram makes trading easy. World keeps control onchain.</h3>
      <div>
        Aomi turns the user&apos;s instruction into a structured action, while
        World governs the agent through an onchain mandate and
        smart-contract-enforced policies.
      </div>
      <ul>
        <li>Trade by message</li>
        <li>Use live World context</li>
        <li>Keep control onchain</li>
      </ul>
      <strong>Product integration preview</strong>
    </div>
  );
}

const scenes = [
  HookScene,
  ConnectScene,
  TelegramScene,
  SecurityScene,
  MandateScene,
  CloseScene,
] as const;

const sceneLabels = [
  "Telegram trading hook",
  "Account handoff",
  "Trade by message",
  "Security boundary",
  "Onchain mandate",
  "Product promise",
] as const;

export function WorldMarketsStoryboard() {
  return (
    <div
      className={styles.storyboard}
      aria-label="World Markets product frames"
    >
      {scenes.map((Scene, index) => (
        <article key={sceneLabels[index]} className={styles.storyboardFrame}>
          <header>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{sceneLabels[index]}</strong>
          </header>
          <div className={styles.animation} data-scene={index}>
            <BrandBar />
            <section
              className={`${styles.scene} ${styles.sceneActive} ${styles.sceneStatic}`}
            >
              <Scene />
            </section>
            <footer className={styles.animationFooter}>
              <div>
                {scenes.map((_, progressIndex) => (
                  <span
                    key={progressIndex}
                    data-active={progressIndex <= index}
                  />
                ))}
              </div>
              <span>
                Frame {String(index + 1).padStart(2, "0")} / {scenes.length}
              </span>
            </footer>
          </div>
        </article>
      ))}
    </div>
  );
}

export function WorldMarketsAnimation() {
  const rootRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const activeSceneRef = useRef(0);
  const [activeScene, setActiveScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  useEffect(() => {
    const seek = (seconds: number) => {
      const elapsed = Math.max(
        0,
        Math.min(Number(seconds) || 0, totalDuration / 1000),
      );
      elapsedRef.current = Math.min(elapsed * 1000, totalDuration - 1);
      lastTickRef.current = 0;
      setIsPlaying(false);
      setIsSeeking(true);
      activeSceneRef.current = sceneAt(elapsedRef.current);
      setActiveScene(activeSceneRef.current);
    };

    window.__AOMI_VIDEO__ = {
      duration: totalDuration / 1000,
      seek,
      play: () => {
        setIsSeeking(false);
        setIsPlaying(true);
      },
      pause: () => setIsPlaying(false),
    };
    window.__AOMI_VIDEO_READY__ = true;

    return () => {
      delete window.__AOMI_VIDEO__;
      delete window.__AOMI_VIDEO_READY__;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPlaying(
          entry.isIntersecting && !document.hidden && !reducedMotion.matches,
        );
      },
      { threshold: 0.35 },
    );
    const handleVisibility = () => {
      if (document.hidden) setIsPlaying(false);
      else {
        const bounds = root.getBoundingClientRect();
        const visible =
          Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
        setIsPlaying(visible >= bounds.height * 0.35 && !reducedMotion.matches);
      }
    };

    observer.observe(root);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = 0;
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      if (!lastTickRef.current) lastTickRef.current = now;
      elapsedRef.current =
        (elapsedRef.current + now - lastTickRef.current) % totalDuration;
      lastTickRef.current = now;
      const nextScene = sceneAt(elapsedRef.current);
      if (activeSceneRef.current !== nextScene) {
        activeSceneRef.current = nextScene;
        setActiveScene(nextScene);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  return (
    <div
      ref={rootRef}
      className={styles.animation}
      data-playing={isPlaying}
      data-scene={activeScene}
      data-seeking={isSeeking}
      role="img"
      aria-label="Animated World Markets and Aomi product preview showing Telegram trading with onchain account controls"
    >
      <BrandBar />
      {scenes.map((Scene, index) => (
        <section
          key={index}
          className={`${styles.scene} ${index === activeScene ? styles.sceneActive : ""}`}
          aria-hidden="true"
        >
          <Scene />
        </section>
      ))}
      <footer className={styles.animationFooter}>
        <div>
          {scenes.map((_, index) => (
            <span key={index} data-active={index <= activeScene} />
          ))}
        </div>
        <span>Concept demo · illustrative UI · 2026</span>
      </footer>
    </div>
  );
}
