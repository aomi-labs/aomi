"use client";

import type { FC } from "react";
import { ArchiveIcon, ScissorsIcon } from "lucide-react";

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

/** Chips render only with an icon; the row's own icon says what happened. */
const NoIcon: FC = () => null;

export const interpretContextStep = (
  step: ContextStep,
): InterpretedToolStep => {
  const chip = (label: string) => ({ label, icon: NoIcon });
  return step.kind === "compacted"
    ? {
        icon: ArchiveIcon,
        title: "Summarized earlier conversation",
        chips: [chip(`${tokens(step.tokensBefore)} → ${tokens(step.tokensAfter)} tokens`)],
        confidence: "high",
        rawLabel: "context_compacted",
        failed: false,
      }
    : {
        icon: ScissorsIcon,
        title: `Trimmed ${step.tool} output`,
        chips: [chip(`${size(step.bytes)} → ${tokens(step.tokens)} tokens`)],
        confidence: "high",
        rawLabel: "tool_output_trimmed",
        failed: false,
      };
};

/** The one-line explanation shown when the row is opened. */
const detail = (step: ContextStep): string =>
  step.kind === "compacted"
    ? `The conversation grew past the model's working budget, so the earlier part was summarized (${tokens(step.tokensBefore)} → ${tokens(step.tokensAfter)} tokens, ${seconds(step.durationMs)}). Recent messages are kept word for word, and your stated limits are carried over exactly.`
    : `${step.tool} returned ${size(step.bytes)}. The model saw a shortened view of about ${tokens(step.tokens)} tokens and can read the rest when it needs it.`;

/**
 * A context step in the working trace: earlier conversation summarized, or a
 * large tool output shortened. Context steps are always complete when they
 * arrive, so they never carry the live shimmer.
 */
export const ContextStepRow: FC<{
  step: ContextStep;
  stepKey: string;
  animate: boolean;
}> = ({ step, stepKey, animate }) => {
  return (
    <ToolStepRow
      viewKey={stepKey}
      interpretation={interpretContextStep(step)}
      detailText={detail(step)}
      done
      active={false}
      animate={animate}
    />
  );
};
