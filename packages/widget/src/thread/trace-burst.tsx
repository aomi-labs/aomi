"use client";

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useChatViewFlag, type TaskRunState } from "@aomi-labs/react";
import {
  contextStepDetail,
  interpretContextStep,
  interpretReadOutput,
  readOutputDetail,
  type InterpretedToolStep,
  type TraceItem as TraceRow,
} from "@aomi-labs/client/trace";

import { cn } from "@/lib/cn";
import { interpretToolStep } from "./attribution";
import { ToolChipView } from "./tool-chip";
import { useTraceAttribution } from "./trace-attribution";
import { traceIcon } from "./trace-icons";
import {
  burstSummary,
  labelParts,
  linePills,
  stepLabel,
  stepTopic,
} from "./trace-labels";
import {
  Arrive,
  Fold,
  Grow,
  StepWindow,
  Swap,
  useFit,
  useFlip,
} from "./trace-motion";
import { agentStepCount, WorkingAgent } from "./working-agent";
import { toDetailString, ToolStepRow } from "./working-trace-rows";

type TraceItem = TraceRow<ToolCallMessagePart, TaskRunState>;

type Step = {
  item: TraceItem;
  label: string;
  step?: InterpretedToolStep;
  argsText?: string;
  detailText?: string;
  done: boolean;
  failed: boolean;
};

/** A line stays this long before it may change again. */
const DWELL_MS = 900;
/** Calls that arrive together settle into one change. */
const SETTLE_MS = 160;

/** How many steps the line speaks for, in calm beats. */
function useBeat(count: number, live: boolean): { from: number; to: number } {
  const [beat, setBeat] = useState({
    from: 0,
    to: live ? Math.min(count, 1) : count,
  });
  const changed = useRef(0);
  const started = useRef(false);
  useEffect(() => {
    if (!live) {
      setBeat({ from: 0, to: count });
      return;
    }
    if (count === beat.to) return;
    const wait = Math.max(SETTLE_MS, changed.current + DWELL_MS - Date.now());
    const timer = setTimeout(() => {
      changed.current = Date.now();
      // The first call of a batch shows at once; its batch keeps it.
      const first = !started.current;
      started.current = true;
      setBeat((before) => ({
        from: first ? 0 : Math.min(before.to, count - 1),
        to: count,
      }));
    }, wait);
    return () => clearTimeout(timer);
  }, [count, live, beat.to]);
  return live
    ? {
        from: Math.min(beat.from, Math.max(0, count - 1)),
        to: Math.min(beat.to, count),
      }
    : { from: 0, to: count };
}

function useSteps(
  items: readonly TraceItem[],
  earlier: readonly unknown[],
): Step[] {
  const attribution = useTraceAttribution();
  return useMemo(() => {
    const related = [...earlier];
    return items.map((item): Step => {
      if (item.kind === "tool") {
        const { tool } = item;
        const argsText =
          tool.argsText && tool.argsText !== "undefined"
            ? tool.argsText
            : undefined;
        const done = tool.result !== undefined;
        const step = interpretToolStep({
          attribution,
          toolName: tool.toolName,
          argsText,
          result: tool.result,
          relatedResults: [...related],
        });
        related.push(tool.result);
        return {
          item,
          step,
          argsText,
          detailText: done ? toDetailString(tool.result) : undefined,
          done,
          failed:
            (step.outcome ?? (step.failed ? "failed" : "success")) === "failed",
          label: stepLabel(step, {
            topic: stepTopic(argsText),
            toolName: tool.toolName,
            done,
          }),
        };
      }
      if (item.kind === "read") {
        const step = interpretReadOutput(item.parts, item.sourceTool);
        const done = item.parts.every((part) => part.result !== undefined);
        return {
          item,
          step,
          detailText: readOutputDetail(item.parts),
          done,
          failed: step.failed,
          label: stepLabel(step, { done }),
        };
      }
      if (item.kind === "context") {
        const step = interpretContextStep(item.step);
        return {
          item,
          step,
          detailText: contextStepDetail(item.step),
          done: item.step.kind !== "compacting",
          failed: false,
          label: step.title,
        };
      }
      const label =
        (item.kind === "agent" && (item.run?.label as string | undefined)) ||
        "agent";
      return {
        item,
        label: `Asked ${label}`,
        done: item.kind !== "agent" || item.run?.status !== "running",
        failed: item.kind === "agent" && item.run?.status === "failed",
      };
    });
  }, [items, earlier, attribution]);
}

const LineText: FC<{ text: string }> = ({ text }) => (
  <>
    {labelParts(text).map((part, index) => (
      <span
        key={index}
        className={
          part.quiet
            ? "text-aomi-muted group-hover/line:text-aomi-fg font-normal transition-colors"
            : "text-aomi-fg font-medium"
        }
      >
        {part.text}
      </span>
    ))}
  </>
);

const lineIcon = (steps: readonly Step[]) => {
  const branded = steps.find((step) =>
    step.step?.chips.some((chip) => chip.packageId),
  );
  return branded ?? steps[0];
};

/** One burst of tool calls: a single quiet line that opens into its steps. */
export const TraceBurst: FC<{
  viewKey: string;
  items: readonly TraceItem[];
  earlier: readonly unknown[];
  /** The newest burst of a running turn. */
  live: boolean;
  /** The turn is still running, so new rows may animate. */
  animate: boolean;
  /** The reader opened or closed this line. */
  onTouch?: () => void;
}> = ({ viewKey, items, earlier, live, animate, onTouch }) => {
  const steps = useSteps(items, earlier);
  const { packages } = useTraceAttribution();
  const [open, setOpen] = useChatViewFlag(`${viewKey}:line`, false);
  const [all, setAll] = useChatViewFlag(`${viewKey}:all`, false);
  const beat = useBeat(steps.length, live);
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current = steps.length;
  });

  const shown = steps.slice(0, Math.max(1, beat.to));
  const plain = live && !open;
  const part = plain
    ? steps.slice(beat.from, Math.max(beat.from + 1, beat.to))
    : shown;
  const label = burstSummary(part.map((step) => step.label));
  const single = plain && part.length === 1;
  const head = single ? part[0] : lineIcon(part);
  const chip = head?.step?.chips.find((item) => item.packageId);
  const Icon =
    packages?.find((item) => item.id === chip?.packageId)?.Icon ??
    (head?.step ? traceIcon(chip?.icon ?? head.step.icon) : traceIcon("agent"));
  const pills = plain
    ? linePills(
        part.flatMap((step) => step.step?.chips ?? []),
        label,
        3,
      )
    : [];
  const count = shown.reduce(
    (total, { item }) =>
      total + 1 + (item.kind === "agent" ? agentStepCount(item.run) : 0),
    0,
  );
  const failed = live ? 0 : steps.filter((step) => step.failed).length;
  // Fit first, so what slides starts from the final layout.
  const line = useFit<HTMLButtonElement>(label);
  const flip = useFlip<HTMLButtonElement>();
  const iconId = `${head?.step?.icon}:${chip?.packageId ?? ""}`;

  return (
    <Arrive animate={animate} className="aui-trace-burst -ml-[1.5px]">
      <button
        ref={(node) => {
          line.current = node;
          flip.current = node;
        }}
        type="button"
        aria-expanded={open}
        onClick={() => {
          onTouch?.();
          setOpen((value) => !value);
        }}
        className="group/line focus-visible:outline-aomi-accent rounded-control relative flex min-h-7 w-fit max-w-full items-center gap-2.5 text-left text-sm leading-5 outline-offset-[3px] focus-visible:outline-2"
      >
        <span className="text-aomi-muted group-hover/line:text-aomi-fg flex w-4 shrink-0 justify-center transition-colors">
          <Swap id={iconId}>
            <span className="flex size-4 items-center justify-center">
              <Icon className="block size-[15px] shrink-0" />
            </span>
          </Swap>
        </span>
        <Swap id={label} fitText>
          <LineText text={label} />
        </Swap>
        {pills.length > 0 && (
          <span data-fit-box className="flex shrink-0 gap-1.5">
            {pills.map((item) => (
              <span
                key={item.label}
                data-fit
                data-flip={`pill:${item.label}`}
                className="flex shrink-0"
              >
                <ToolChipView chip={item} compact />
              </span>
            ))}
          </span>
        )}
        {count > 1 && (
          <span
            data-flip="count"
            className="text-aomi-muted shrink-0 text-[13px] tabular-nums"
          >
            {count} steps
          </span>
        )}
        {failed > 0 && (
          <span
            data-flip="failed"
            className="text-aomi-muted shrink-0 text-[13px]"
          >
            {failed} failed
          </span>
        )}
        <span data-flip="arrow" className="shrink-0">
          <ChevronRightIcon
            className={cn(
              "text-aomi-muted group-hover/line:text-aomi-fg size-3 opacity-75 transition-[rotate,opacity,color] duration-300 group-hover/line:opacity-100",
              open && "rotate-90",
            )}
          />
        </span>
      </button>
      <Fold open={open}>
        <div className="pb-1 pt-1.5">
          <StepWindow
            open={open}
            live={live}
            count={steps.length}
            expanded={all}
            onExpandedChange={setAll}
            more={(expanded, total) => (
              <>
                <ChevronDownIcon
                  className={cn(
                    "mx-0.5 size-3 opacity-75 transition-[rotate] duration-300",
                    expanded && "rotate-180",
                  )}
                />
                {expanded ? "Show fewer" : `Show all ${total} steps`}
              </>
            )}
          >
            {steps.map((step, index) => (
              <Grow
                key={step.item.key}
                animate={
                  animate &&
                  open &&
                  index >= mounted.current &&
                  mounted.current > 0
                }
              >
                {step.item.kind === "agent" ? (
                  <div className="py-[7px]">
                    <WorkingAgent
                      agentId={step.item.agentId}
                      run={step.item.run}
                      tool={step.item.tool}
                      order={step.item.order}
                      active={live && index === steps.length - 1}
                      animate={false}
                    />
                  </div>
                ) : step.step ? (
                  <ToolStepRow
                    viewKey={step.item.key}
                    interpretation={step.step}
                    label={step.label}
                    argsText={step.argsText}
                    detailText={step.detailText}
                    done={step.done}
                    active={!step.done && live}
                    animate={false}
                    animateUpdates={live}
                  />
                ) : null}
              </Grow>
            ))}
          </StepWindow>
        </div>
      </Fold>
    </Arrive>
  );
};
