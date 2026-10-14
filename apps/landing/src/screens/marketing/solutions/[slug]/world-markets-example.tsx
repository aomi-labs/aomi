"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import styles from "./defi.module.css";
import {
  WorldMarketsAnimation,
  WorldMarketsStoryboard,
} from "./world-markets-animation";

const views = [
  {
    id: "flow",
    label: "Product flow",
    eyebrow: "Ready-to-go integration",
    title: "Expand the trading experience without moving authority into chat.",
    intro:
      "Aomi carries the selected World context and actions into Telegram, prepares the structured trade, and returns the user to the relevant market or position.",
    steps: [
      {
        label: "01",
        title: "Connect",
        body: "The owner selects a World account and opens a short-lived Telegram handoff.",
      },
      {
        label: "02",
        title: "Ask",
        body: "“Place a 0.5 WETH limit order at 3,420.”",
      },
      {
        label: "03",
        title: "Prepare",
        body: "Aomi loads live account and market context and constructs the World action.",
      },
      {
        label: "04",
        title: "Check",
        body: "World verifies the delegated trader and applies portfolio-risk requirements.",
      },
    ],
  },
  {
    id: "authority",
    label: "Authority",
    eyebrow: "The onchain mandate",
    title: "The agent can trade. It cannot take custody.",
    intro:
      "World's contracts remain the enforcement boundary. Aomi can operate only inside the authority the account owner records onchain.",
    steps: [
      {
        label: "Owner",
        title: "Selects the account",
        body: "Retains deposit and withdrawal authority and can revoke the trader onchain.",
      },
      {
        label: "Aomi",
        title: "Receives trade-only access",
        body: "Interprets intent and prepares actions for the selected World account.",
      },
      {
        label: "World",
        title: "Verifies every action",
        body: "Checks trader authorization, available margin, and ATLAS portfolio risk.",
      },
      {
        label: "Result",
        title: "Accept or reject",
        body: "The language model cannot override the authority recorded by World.",
      },
    ],
  },
] as const;

export function WorldMarketsExample({
  presentation = "animation",
}: {
  presentation?: "animation" | "storyboard";
}) {
  const [activeId, setActiveId] =
    useState<(typeof views)[number]["id"]>("flow");
  const active = views.find((view) => view.id === activeId) ?? views[0];

  return (
    <section className={styles.worldSection} id="world-markets-example">
      <header className={styles.worldHeading}>
        <div>
          <p className={styles.eyebrow}>
            Working example / World Markets × Aomi
          </p>
          <h2>Trade on World from Telegram. Expand the UX, keep control.</h2>
        </div>
        <div className={styles.worldIntro}>
          <span>Product integration preview</span>
          <p>
            Aomi adds a ready-to-go Telegram surface and structured World
            actions. World keeps account authority, revocation, and portfolio
            risk enforceable outside the model.
          </p>
        </div>
      </header>

      <div className={styles.worldShowcase}>
        {presentation === "storyboard" ? (
          <WorldMarketsStoryboard />
        ) : (
          <WorldMarketsAnimation />
        )}

        <div className={styles.worldPanel}>
          <div className={styles.worldTabs} role="tablist">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={view.id === active.id}
                onClick={() => setActiveId(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className={styles.worldPanelCopy}>
            <p className={styles.eyebrow}>{active.eyebrow}</p>
            <h3>{active.title}</h3>
            <p>{active.intro}</p>
          </div>

          <ol className={styles.worldSteps}>
            {active.steps.map((step) => (
              <li key={step.label}>
                <span>{step.label}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className={styles.worldValidation}>
        <div>
          <p className={styles.eyebrow}>What this example validates</p>
          <h3>A broader trading experience with enforced boundaries.</h3>
        </div>
        <ul>
          <li>
            <Check aria-hidden /> Ready-to-go Telegram integration
          </li>
          <li>
            <Check aria-hidden /> Account-aware World action space
          </li>
          <li>
            <Check aria-hidden /> Owner-retained withdrawal authority
          </li>
          <li>
            <Check aria-hidden /> Onchain authorization and revocation
          </li>
          <li>
            <Check aria-hidden /> World portfolio-risk enforcement
          </li>
          <li>
            <ShieldCheck aria-hidden /> No production trade claimed without a
            receipt
          </li>
        </ul>
      </div>
    </section>
  );
}
