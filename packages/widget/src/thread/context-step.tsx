"use client";

import type { FC } from "react";
import { ArchiveIcon, LayersIcon, ScissorsIcon } from "lucide-react";

import type { ContextStep } from "@aomi-labs/react";
import type { InterpretedToolStep } from "@/thread/tool-interpreter/interpret";
import { ToolStepRow } from "./working-trace-rows";

/** "151k", "14k", "820" */
const tokens = (count: number): string =>
  count >= 1_000 ? `${Math.round(count / 1_000)}k` : String(count);

/** "2.1 MB", "48 KB", "512 B" */
const size = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : bytes >= 1_024
      ? `${Math.round(bytes / 1_024)} KB`
      : `${bytes} B`;

const seconds = (ms: number): string => `${(ms / 1_000).toFixed(1)} s`;

export const interpretContextStep = (
  step: ContextStep,
): InterpretedToolStep => {
  const chip = (label: string) => ({ label, icon: LayersIcon });
  switch (step.kind) {
    case "compacting":
      return {
        icon: ArchiveIcon,
        title: "Summarizing earlier conversation",
        chips: [chip(`${tokens(step.tokensBefore)} tokens`)],
        confidence: "high",
        rawLabel: "context_compacting",
        failed: false,
      };
    case "compacted":
      return step.published
        ? {
            icon: ArchiveIcon,
            title: "Summarized earlier conversation",
            chips: [
              chip(`${tokens(step.tokensBefore)} to ${tokens(step.tokensAfter)} tokens`),
            ],
            confidence: "high",
            rawLabel: "context_compacted",
            failed: false,
          }
        : {
            icon: ArchiveIcon,
            title: "Could not use the summary",
            chips: [],
            confidence: "high",
            rawLabel: "context_compacted",
            failed: false,
            outcome: "incomplete",
          };
    case "trimmed":
      return {
        icon: ScissorsIcon,
        title: `Trimmed ${step.tool} output`,
        chips: [chip(`${size(step.bytes)} to ${tokens(step.tokens)} tokens`)],
        confidence: "high",
        rawLabel: "tool_output_trimmed",
        failed: false,
      };
  }
};

/** The one-line explanation shown when the row is opened. */
const detail = (step: ContextStep): string => {
  switch (step.kind) {
    case "compacting":
      return "The conversation grew past the model's working budget, so the earlier part is being summarized. This can take a minute.";
    case "compacted":
      return step.published
        ? `The conversation grew past the model's working budget, so the earlier part was summarized (${tokens(step.tokensBefore)} to ${tokens(step.tokensAfter)} tokens, ${seconds(step.durationMs)}). Recent messages are kept word for word, and your stated limits are carried over exactly.`
        : "A summary could not be used this time, so the reply went ahead with the oldest messages left out instead.";
    case "trimmed":
      return `${step.tool} returned ${size(step.bytes)}. The model saw a shortened view of about ${tokens(step.tokens)} tokens and can read the rest when it needs it.`;
  }
};

/**
 * A context step in the working trace: earlier conversation being or having
 * been summarized, or a large tool output shortened. Only a summary in
 * progress, while the turn runs, carries the live shimmer.
 */
export const ContextStepRow: FC<{
  step: ContextStep;
  stepKey: string;
  animate: boolean;
  live: boolean;
}> = ({ step, stepKey, animate, live }) => {
  const working = step.kind === "compacting" && live;
  return (
    <ToolStepRow
      viewKey={stepKey}
      interpretation={interpretContextStep(step)}
      detailText={detail(step)}
      done={!working}
      active={working}
      animate={animate}
    />
  );
};
