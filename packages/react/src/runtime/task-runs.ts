"use client";

import { useMemo } from "react";
import type {
  Event,
  TaskActivityEvent,
  TaskCompletedEvent,
  TaskPhaseEvent,
  TaskStartedEvent,
} from "@aomi-labs/client";

import { useAomiRuntime } from "../interface";
import { parseTimestamp } from "./utils";

export type TaskRunStep =
  | {
      kind: "tool_call";
      toolName: string;
      args: unknown;
      resultPreview: string;
      childSeq: number;
    }
  | { kind: "note"; text: string; childSeq: number };

export type TaskRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "stalled"
  | "cancelled";

export type TaskRunState = {
  agentId: string;
  callId: string;
  label: string;
  app: string;
  status: TaskRunStatus;
  startedAt: number;
  phase?: string;
  elapsedMs?: number;
  steps: TaskRunStep[];
  message?: string;
  stagedCount?: number;
  durationMs?: number;
  stepCount?: number;
};

export type ThreadTaskRuns = Readonly<Record<string, TaskRunState>>;

export const EMPTY_TASK_RUNS: ThreadTaskRuns = Object.freeze({});

type TaskEvent =
  | TaskStartedEvent
  | TaskPhaseEvent
  | TaskActivityEvent
  | TaskCompletedEvent;

const isTaskEvent = (event: Event): event is TaskEvent =>
  event.type === "task_started" ||
  event.type === "task_phase" ||
  event.type === "task_activity" ||
  event.type === "task_completed";

const emptyRun = (event: TaskEvent): TaskRunState => ({
  agentId: event.agent_id,
  callId: event.call_id,
  label: "",
  app: "",
  status: "running",
  // The wire sends epoch seconds; consumers compare against Date.now() ms.
  startedAt: parseTimestamp(event.occurred_at),
  steps: [],
});

const insertStep = (
  steps: TaskRunStep[],
  event: TaskActivityEvent,
): TaskRunStep[] => {
  if (steps.some((step) => step.childSeq === event.child_seq)) return steps;
  const step: TaskRunStep =
    event.kind === "note"
      ? { kind: "note", text: event.text, childSeq: event.child_seq }
      : {
          kind: "tool_call",
          toolName: event.tool_name,
          args: event.args,
          resultPreview: event.result_preview,
          childSeq: event.child_seq,
        };
  return [...steps, step].sort((left, right) => left.childSeq - right.childSeq);
};

export function selectTaskRuns(events: readonly Event[]): ThreadTaskRuns {
  return events.filter(isTaskEvent).reduce<Record<string, TaskRunState>>(
    (runs, event) => {
      const current = runs[event.agent_id] ?? emptyRun(event);
      switch (event.type) {
        case "task_started":
          runs[event.agent_id] = {
            ...current,
            callId: event.call_id,
            label: event.label ?? "",
            app: event.app,
            startedAt: parseTimestamp(event.occurred_at),
          };
          break;
        case "task_phase":
          runs[event.agent_id] = {
            ...current,
            app: event.app,
            phase: event.phase,
            elapsedMs: event.elapsed_ms,
          };
          break;
        case "task_activity":
          runs[event.agent_id] = {
            ...current,
            steps: insertStep(current.steps, event),
          };
          break;
        case "task_completed":
          runs[event.agent_id] = {
            ...current,
            status: event.status,
            message: event.message,
            stagedCount: event.staged_count,
            stepCount: event.steps,
            durationMs: event.duration_ms,
          };
          break;
      }
      return runs;
    },
    {},
  );
}

export function useThreadTaskRuns(): ThreadTaskRuns {
  const { events } = useAomiRuntime();
  return useMemo(() => selectTaskRuns(events), [events]);
}

export function useTaskRun(agentId: string | undefined): TaskRunState | undefined {
  const runs = useThreadTaskRuns();
  return agentId ? runs[agentId] : undefined;
}
