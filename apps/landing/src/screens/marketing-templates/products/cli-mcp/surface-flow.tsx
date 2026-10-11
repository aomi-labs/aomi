"use client";

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  FlaskConical,
  KeyRound,
  Network,
  Terminal,
  Waypoints,
} from "lucide-react";
import styles from "./agentic-surfaces.module.css";

type SurfaceId = "skills" | "mcp" | "cli";

const ICONS = { skills: Bot, mcp: Network, cli: Terminal } as const;

export type FlowSurface = {
  id: SurfaceId;
  index: string;
  title: string;
  body: string;
  bestFor: string;
  action: string;
  href: string;
};

const HARNESS_FACTS = [
  "One Aomi account",
  "Policy enforced outside the model",
  "Sessions resumable across surfaces",
] as const;

/**
 * "Choose your surface" as a flow: three entry nodes converge into the Aomi
 * execution harness, then Simulate → Sign. Hovering or focusing a node lights
 * its connector. Clicking routes to the Interactive Setup tab.
 */
export function SurfaceFlow({
  surfaces,
}: {
  surfaces: readonly FlowSurface[];
}) {
  const [active, setActive] = useState<SurfaceId | null>(null);

  return (
    <div className={styles.flow} aria-label="Three surfaces, one harness">
      <div className={`${styles.sectionHeading} ${styles.flowIntro}`}>
        <div>
          <p className={styles.eyebrow}>Choose your surface</p>
          <h2>Start with a compatible interface with flexibility.</h2>
        </div>
        <p>
          These entry points share execution infrastructure, but they solve
          different setup, session, and signing problems.
        </p>
      </div>

      <div className={styles.flowRail}>
        {surfaces.map((surface) => {
          const Icon = ICONS[surface.id];
          const isActive = active === surface.id;
          return (
            <article
              key={surface.id}
              className={`${styles.flowNode} ${isActive ? styles.flowNodeActive : ""}`}
              onMouseEnter={() => setActive(surface.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(surface.id)}
              onBlur={() => setActive(null)}
            >
              <div className={styles.flowNodeTop}>
                <span className={styles.flowIcon}>
                  <Icon aria-hidden />
                </span>
                <h3>{surface.title}</h3>
                <span className={styles.flowIndex}>{surface.index}</span>
              </div>
              <p>{surface.body}</p>
              <div className={styles.flowBestFor}>
                <span>Best for</span>
                <strong>{surface.bestFor}</strong>
              </div>
              <Link to="." search={() => ({surface: surface.id})} hash={surface.href.slice(1)}>
                {surface.action}
                <ArrowRight aria-hidden />
              </Link>
              <i className={styles.flowStub} aria-hidden />
            </article>
          );
        })}
      </div>

      <div className={styles.flowBus} aria-hidden>
        <i
          className={`${styles.busTop} ${active === "skills" ? styles.busLive : ""}`}
        />
        <i
          className={`${styles.busMid} ${active === "mcp" ? styles.busLive : ""}`}
        />
        <i
          className={`${styles.busBottom} ${active === "cli" ? styles.busLive : ""}`}
        />
        <i className={`${styles.busOut} ${active ? styles.busLive : ""}`} />
        <i className={`${styles.busDot} ${active ? styles.busLive : ""}`} />
      </div>

      <div className={styles.flowHarness}>
        <span className={styles.flowIcon}>
          <Waypoints aria-hidden />
        </span>
        <h3>Aomi execution harness</h3>
        <ul>
          {HARNESS_FACTS.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </div>

      <div className={styles.flowStages}>
        <ArrowRight className={styles.flowArrow} aria-hidden />
        <div className={styles.flowStage}>
          <FlaskConical aria-hidden />
          <strong>Simulate</strong>
          <small>rehearsed on a fork</small>
        </div>
        <ArrowRight className={styles.flowArrow} aria-hidden />
        <div className={`${styles.flowStage} ${styles.flowStageSign}`}>
          <KeyRound aria-hidden />
          <strong>Sign</strong>
          <small>your wallet, never Aomi</small>
        </div>
      </div>
    </div>
  );
}
