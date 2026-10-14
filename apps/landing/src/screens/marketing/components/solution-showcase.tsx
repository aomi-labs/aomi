"use client";

import { Check, CircleDot } from "lucide-react";
import { useState } from "react";
import type { SolutionConfig } from "../../marketing-templates/solutions/solution-data";
import styles from "../marketing.module.css";

export function SolutionShowcase({ solution }: { solution: SolutionConfig }) {
  const [selectedId, setSelectedId] = useState(solution.demoOptions[0].id);
  const selected =
    solution.demoOptions.find((option) => option.id === selectedId) ??
    solution.demoOptions[0];

  return (
    <div className={styles.solutionShowcase}>
      <header>
        <div>
          <CircleDot aria-hidden />
          <span>{solution.demoName}</span>
        </div>
        <small>{solution.demoContext}</small>
      </header>

      <div className={styles.solutionShowcaseTabs} role="tablist">
        {solution.demoOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={option.id === selected.id}
            onClick={() => setSelectedId(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.solutionShowcasePrompt}>
        <span>Intent</span>
        <p>“{selected.prompt}”</p>
      </div>

      <div className={styles.solutionShowcaseResult}>
        <span>Proposed action</span>
        <h2>{selected.title}</h2>
        <p>{selected.detail}</p>
      </div>

      <dl className={styles.solutionShowcaseMetrics}>
        {selected.metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>

      <footer>
        <div>
          {selected.checks.map((check) => (
            <span key={check}>
              <Check aria-hidden /> {check}
            </span>
          ))}
        </div>
        <strong>Simulation ready</strong>
      </footer>
    </div>
  );
}
