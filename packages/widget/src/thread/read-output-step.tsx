"use client";

import type { FC } from "react";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import { interpretReadOutput, readOutputDetail } from "@aomi-labs/client/trace";

import { ToolStepRow } from "./working-trace-rows";

/**
 * Consecutive `read_tool_output` calls on one saved output, folded into a
 * single row named after the tool that produced the output.
 */
export const ReadOutputRow: FC<{
  parts: readonly ToolCallMessagePart[];
  sourceTool?: string;
  stepKey: string;
  active: boolean;
  animate: boolean;
  live: boolean;
}> = ({ parts, sourceTool, stepKey, active, animate, live }) => {
  const done = parts.every((part) => part.result !== undefined);
  return (
    <ToolStepRow
      viewKey={stepKey}
      interpretation={interpretReadOutput(parts, sourceTool)}
      detailText={readOutputDetail(parts)}
      done={done}
      active={active}
      animate={animate}
      animateUpdates={live}
    />
  );
};
