import { describe, expect, it } from "vitest";
import type { Event } from "@aomi-labs/client";

import { selectTaskRuns } from "../task-runs";

const meta = (sequence: number, type: Event["type"]) => ({
  event_id: `event-${sequence}`,
  sequence,
  turn_id: "turn-1",
  occurred_at: 1_735_000_000_000 + sequence,
  type,
});

describe("selectTaskRuns", () => {
  it("derives task presentation only from concrete ledger events", () => {
    const events: Event[] = [
      {
        ...meta(1, "task_started"),
        type: "task_started",
        call_id: "call-1",
        agent_id: "agent-1",
        label: "Trader",
        app: "swap",
        resumed: false,
      },
      {
        ...meta(2, "task_phase"),
        type: "task_phase",
        call_id: "call-1",
        agent_id: "agent-1",
        app: "swap",
        phase: "executing",
        elapsed_ms: 10,
        observed_at_ms: 20,
      },
      {
        ...meta(3, "task_activity"),
        type: "task_activity",
        call_id: "call-1",
        agent_id: "agent-1",
        child_seq: 1,
        kind: "tool_call",
        tool_name: "quote",
        args: { amount: "1" },
        result_preview: "ok",
      },
      {
        ...meta(4, "task_completed"),
        type: "task_completed",
        call_id: "call-1",
        agent_id: "agent-1",
        status: "completed",
        message: "done",
        staged_count: 1,
        steps: 1,
        duration_ms: 50,
      },
    ];

    expect(selectTaskRuns(events)["agent-1"]).toMatchObject({
      label: "Trader",
      app: "swap",
      phase: "executing",
      elapsedMs: 10,
      status: "completed",
      message: "done",
      steps: [
        {
          kind: "tool_call",
          toolName: "quote",
          childSeq: 1,
        },
      ],
    });
  });

  it("normalizes epoch-second timestamps so startedAt is comparable to Date.now()", () => {
    // The wire sends occurred_at in epoch seconds. Stored raw, the trace
    // header renders `Date.now() - startedAt` as ~56 years of elapsed time.
    const startedAtSeconds = 1_756_000_000;
    const events: Event[] = [
      {
        ...meta(1, "task_started"),
        occurred_at: startedAtSeconds,
        type: "task_started",
        call_id: "call-1",
        agent_id: "agent-1",
        label: "Trader",
        app: "swap",
        resumed: false,
      },
    ];

    expect(selectTaskRuns(events)["agent-1"]?.startedAt).toBe(
      startedAtSeconds * 1000,
    );
  });

  it("resets a continued child and ignores late events from its prior invocation", () => {
    const started = (sequence: number, call_id: string): Event => ({
      ...meta(sequence, "task_started"),
      type: "task_started",
      call_id,
      agent_id: "agent-1",
      label: "Trader",
      app: "swap",
      resumed: sequence > 1,
    });
    const completed = (sequence: number, call_id: string): Event => ({
      ...meta(sequence, "task_completed"),
      type: "task_completed",
      call_id,
      agent_id: "agent-1",
      status: "completed",
      message: "old answer",
      staged_count: 1,
      steps: 1,
      duration_ms: 50,
    });
    const events: Event[] = [
      started(1, "first"),
      completed(2, "first"),
      started(3, "second"),
      completed(4, "first"),
      {
        ...meta(5, "task_activity"),
        type: "task_activity",
        call_id: "first",
        agent_id: "agent-1",
        child_seq: 1,
        kind: "note",
        text: "late old note",
      },
    ];
    const current = selectTaskRuns(events)["agent-1"];
    expect(current).toMatchObject({
      callId: "second",
      status: "running",
      steps: [],
    });
    expect(current?.message).toBeUndefined();
    expect(current?.stagedCount).toBeUndefined();
    expect(current?.durationMs).toBeUndefined();
  });

  it("limits turn traces to the current turn while retaining thread activity", () => {
    const events: Event[] = [
      {
        ...meta(1, "task_started"),
        type: "task_started",
        call_id: "old",
        agent_id: "old-child",
        label: "Old",
        app: "default",
        resumed: false,
      },
      {
        ...meta(2, "message"),
        type: "message",
        sender: "user",
        turn_id: "turn-2",
        content: "Next request",
      } as Event,
      {
        ...meta(3, "task_started"),
        type: "task_started",
        call_id: "new",
        turn_id: "turn-2",
        agent_id: "new-child",
        label: "New",
        app: "default",
        resumed: false,
      },
    ];
    expect(Object.keys(selectTaskRuns(events))).toEqual([
      "old-child",
      "new-child",
    ]);
    expect(Object.keys(selectTaskRuns(events, "turn"))).toEqual(["new-child"]);
  });
});
