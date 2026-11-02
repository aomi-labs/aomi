import { describe, expect, it } from "vitest";

import type { Event } from "../agent/types";
import { buildTraceItems, traceFromEvents } from "./items";
import { readOutputDetail } from "./read-output";
import type { TraceToolPart } from "./types";

type Run = {
  agentId: string;
  callId: string;
  status: string;
  message?: string;
};

const run = (): Run => ({
  agentId: "task-agent:9f2c1a2b3c4d",
  callId: "call-1",
  status: "running",
});

describe("delegated runs", () => {
  it("keeps a failed delegation at its transcript position after recovery", () => {
    const failedRun: Run = {
      ...run(),
      status: "failed",
      message: "LI.FI route was unavailable",
    };
    const delegatedTask = {
      type: "tool-call" as const,
      argsText: "{}",
      toolCallId: failedRun.callId,
      toolName: "task",
      args: { label: "Prepare swap", app: "default", prompt: "Swap" },
      result: { status: "failed" },
    } satisfies TraceToolPart;
    const recoveredCommit = {
      type: "tool-call" as const,
      argsText: "{}",
      toolCallId: "call-2",
      toolName: "commit",
      args: {},
      result: { status: "completed" },
    } satisfies TraceToolPart;

    const items = buildTraceItems(
      [delegatedTask, recoveredCommit],
      [failedRun],
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "agent",
      agentId: failedRun.agentId,
      run: failedRun,
      tool: delegatedTask,
    });
    expect(items[1]).toMatchObject({
      kind: "tool",
      tool: recoveredCommit,
    });
  });

  it("reconciles a legacy inline task part by its nested failure agent id", () => {
    const failedRun: Run = {
      ...run(),
      status: "failed",
      message: "child failed",
    };
    const delegatedTask = {
      type: "tool-call" as const,
      argsText: "{}",
      toolCallId: "inline:legacy-task-message",
      toolName: "task",
      args: {},
      result: {
        error: { agent_id: failedRun.agentId, code: "child_turn_failed" },
      },
    } satisfies TraceToolPart;

    const items = buildTraceItems([delegatedTask], [failedRun]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "agent",
      agentId: failedRun.agentId,
      run: failedRun,
      tool: delegatedTask,
    });
  });

  it("expands one batch task part into one reconciled row per child", () => {
    const first: Run = {
      ...run(),
      agentId: "task-agent:first",
      callId: "call-batch:1",
    };
    const second: Run = {
      ...run(),
      agentId: "task-agent:second",
      callId: "call-batch:2",
    };
    const delegatedTask = {
      type: "tool-call" as const,
      argsText: "{}",
      toolCallId: "call-batch",
      toolName: "task",
      args: { tasks: [{ prompt: "one" }, { prompt: "two" }] },
      result: {
        status: "completed",
        results: [
          { agent_id: first.agentId, status: "completed" },
          { agent_id: second.agentId, status: "completed" },
        ],
      },
    } satisfies TraceToolPart;

    const items = buildTraceItems([delegatedTask], [first, second]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.kind === "agent" && item.agentId)).toEqual([
      first.agentId,
      second.agentId,
    ]);
  });

  it("keeps repeated child invocations distinct without borrowing the latest state", () => {
    const latest = { ...run(), callId: "second-call" };
    const task = (toolCallId: string): TraceToolPart =>
      ({
        type: "tool-call",
        argsText: "{}",
        toolCallId,
        toolName: "task",
        args: {},
        result: { agent_id: latest.agentId, status: "completed" },
      }) satisfies TraceToolPart;
    const items = buildTraceItems(
      [task("first-call"), task("second-call")],
      [latest],
    );

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
    expect(items[0]).toMatchObject({ kind: "agent", run: undefined });
    expect(items[1]).toMatchObject({ kind: "agent", run: latest });
  });

  it("preserves every transcript child when only part of a batch is live", () => {
    const latest = { ...run(), agentId: "child-b", callId: "batch:2" };
    const task = {
      type: "tool-call",
      argsText: "{}",
      toolCallId: "batch",
      toolName: "task",
      args: {},
      result: { results: [{ agent_id: "child-a" }, { agent_id: "child-b" }] },
    } satisfies TraceToolPart;
    const items = buildTraceItems([task], [latest]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ agentId: "child-a", run: undefined });
    expect(items[1]).toMatchObject({ agentId: "child-b", run: latest });
  });

  it("keeps a live child key stable when its transcript arrives", () => {
    const latest = run();
    const task = {
      type: "tool-call",
      argsText: "{}",
      toolCallId: latest.callId,
      toolName: "task",
      args: {},
      result: { agent_id: latest.agentId },
    } satisfies TraceToolPart;
    expect(buildTraceItems([task], [latest])[0]?.key).toBe(
      buildTraceItems([], [latest])[0]?.key,
    );
  });
});

describe("context steps", () => {
  const compacted = {
    type: "tool-call" as const,
    argsText: "{}",
    toolCallId: "context:event-9",
    toolName: "aomi:context",
    args: {
      kind: "compacted",
      published: true,
      tokensBefore: 151_000,
      tokensAfter: 38_000,
      durationMs: 2_400,
    },
    result: {},
  } satisfies TraceToolPart;
  const trimmed = {
    ...compacted,
    toolCallId: "context:event-8",
    args: {
      kind: "trimmed",
      tool: "evm_commit_txs",
      id: "t_cc98",
      bytes: 70_551,
      tokens: 47,
    },
  } satisfies TraceToolPart;

  it("become their own trace rows in place, except a trimmed output", () => {
    const items = buildTraceItems([trimmed, compacted], []);
    expect(items.map((item) => item.kind)).toEqual(["context"]);
  });
});

describe("reading a shortened output", () => {
  const trimmed = {
    type: "tool-call" as const,
    argsText: "{}",
    toolCallId: "context:event-8",
    toolName: "aomi:context",
    args: {
      kind: "trimmed",
      tool: "evm_commit_txs",
      id: "t_cc98",
      bytes: 70,
      tokens: 4,
    },
    result: {},
  } satisfies TraceToolPart;
  const output = JSON.stringify({ commits: [{ id: "c1" }], ok: true });
  const read = (n: number, offset: number, limit: number) => {
    const slice = output.slice(offset, offset + limit);
    const next = offset + slice.length;
    return {
      type: "tool-call" as const,
      toolCallId: `read-${n}`,
      toolName: "read_tool_output",
      args: { id: "t_cc98", offset, limit },
      argsText: JSON.stringify({ id: "t_cc98", offset, limit }),
      result: {
        id: "t_cc98",
        total_chars: output.length,
        offset,
        slice,
        next_offset: next < output.length ? next : null,
        eof: next >= output.length,
      },
    } satisfies TraceToolPart;
  };
  const reads = [read(1, 0, 15), read(2, 15, 15), read(3, 30, 15)];

  it("open to the stitched output instead of the paging envelopes", () => {
    expect(readOutputDetail(reads)).toBe(
      JSON.stringify(JSON.parse(output), null, 2),
    );
    expect(readOutputDetail(reads.slice(0, 1))).toBe(
      '{\n  "commits": [\n    {\n      "i',
    );
  });

  it("keep a finished read without an id on its own row", () => {
    const anonymous = {
      ...reads[1],
      toolCallId: "read-anon",
      args: {},
      argsText: "{}",
      result: { error: "expired" },
    } satisfies TraceToolPart;
    const items = buildTraceItems([trimmed, reads[0], anonymous], []);
    expect(items.map((item) => item.kind)).toEqual(["read", "read"]);
  });
});

describe("traceFromEvents", () => {
  it("groups one turn's events into notes, steps and folded context", () => {
    const base = { turn_id: "turn-1", occurred_at: 1 };
    const events = [
      {
        ...base,
        type: "message",
        sender: "agent",
        event_id: "e1",
        sequence: 1,
        content: "Checking the balance",
      },
      {
        ...base,
        type: "tool_update",
        id: "u1",
        event_id: "e2",
        sequence: 2,
        call_id: "call-a",
        tool_name: "get_account_info",
      },
      {
        ...base,
        type: "tool_complete",
        id: "c1",
        event_id: "e3",
        sequence: 3,
        call_id: "call-a",
        tool_name: "get_account_info",
        result: { balance: "1" },
      },
      {
        ...base,
        type: "tool_output_trimmed",
        event_id: "e4",
        sequence: 4,
        id: "t_1",
        tool: "get_account_info",
        bytes: 9_000,
        tokens: 40,
      },
    ] as unknown as Event[];

    const items = traceFromEvents(events);

    expect(items.map((item) => item.kind)).toEqual(["note", "tool"]);
    expect(items[1]).toMatchObject({
      kind: "tool",
      tool: { toolCallId: "call-a", result: { balance: "1" } },
    });
  });
});
