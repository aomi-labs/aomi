"use client";

import { AomiFrame } from "@aomi-labs/widget/frame";
import { useEffect, useState } from "react";
import {
  widgetFixtureCatalog,
  type WidgetFixtureKey,
  type WidgetFixtureScenario,
} from "./fixture-data";
import styles from "./integration-showcases.module.css";

interface FixtureWidgetProps {
  scenario: WidgetFixtureScenario;
  fixture: WidgetFixtureKey;
  label: string;
}

const themeClass: Record<WidgetFixtureScenario, string> = {
  somm: styles.fixtureSomm,
  trading: styles.fixtureTrading,
  prediction: styles.fixturePrediction,
  wallet: styles.fixtureSomm,
};

const LEAVE_MS = 180;

/**
 * Swapping `fixture` remounts the frame (new thread, new transcript). To keep
 * that from flashing, the outgoing frame fades out first and the incoming one
 * animates in once it is mounted.
 */
export function FixtureWidget({
  scenario,
  fixture,
  label,
}: FixtureWidgetProps) {
  const [shown, setShown] = useState(fixture);
  const leaving = shown !== fixture;

  useEffect(() => {
    if (shown === fixture) return;
    const timer = window.setTimeout(() => setShown(fixture), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [fixture, shown]);

  const data = widgetFixtureCatalog[shown];

  return (
    <div
      className={`${styles.fixtureMount} ${themeClass[scenario]} ${leaving ? styles.fixtureLeaving : ""}`}
      aria-busy={leaving}
    >
      <div key={shown} className={styles.fixtureEntering}>
        <AomiFrame.Root
          backendUrl={`/api/widget-fixture/${shown}`}
          applicationId={`widget-${scenario}-fixture`}
          accountSessionAvailable
          initialThreadId={`widget-fixture-${shown}`}
          persistThread={false}
          showSidebar={false}
          walletPosition={null}
          width="100%"
          height="100%"
          className={styles.fixtureRoot}
        >
          <AomiFrame.Header
            showSidebarTrigger={false}
            className={styles.fixtureHeader}
          >
            <span className={styles.fixtureTitle}>{data.title}</span>
            <span className={styles.fixtureLabel}>
              <i aria-hidden />
              {label}
            </span>
          </AomiFrame.Header>
          <AomiFrame.Composer className={styles.fixtureComposer} />
          <span className={styles.fixtureNote}>
            Deterministic fixture · no live chat
          </span>
        </AomiFrame.Root>
      </div>
    </div>
  );
}
