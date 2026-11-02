"use client";

import type { FC } from "react";
import {
  contextStepDetail,
  interpretContextStep,
  type ContextStep,
} from "@aomi-labs/client/trace";

import { ToolStepRow } from "./working-trace-rows";

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
      detailText={contextStepDetail(step)}
      done={!working}
      active={working}
      animate={animate}
    />
  );
};
