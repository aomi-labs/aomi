import { act, fireEvent, render } from "@testing-library/react";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskRunState } from "@aomi-labs/react";

vi.mock("@/components/assistant-ui/markdown-text", () => ({
  MarkdownText: () => null,
}));

import { visibleAgentSteps, WorkingAgent } from "./working-agent";

const makeRun = (over: Partial<TaskRunState> = {}): TaskRunState => ({
  agentId: "task-agent:9f2c1a2b3c4d",
  callId: "call-1",
  label: "swap-worker",
  app: "default",
  status: "running",
  startedAt: Date.now(),
  steps: [],
  ...over,
});

const rowOf = (container: HTMLElement): HTMLElement => {
  const row = container.querySelector<HTMLElement>(".aui-working-agent");
  if (!row) throw new Error("no agent row rendered");
  return row;
};

describe("WorkingAgent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts expanded while the run is live", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun()}
        order={0}
        active
        animate={false}
      />,
    );

    const row = rowOf(container);
    expect(row.dataset.open).toBe("true");
    expect(row.dataset.live).toBe("true");
    expect(row).toHaveTextContent("swap-worker");
  });

  it("folds itself a beat after the run goes terminal", () => {
    const { container, rerender } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun()}
        order={0}
        active
        animate={false}
      />,
    );
    expect(rowOf(container).dataset.open).toBe("true");

    rerender(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          status: "completed",
          message: "staged 1 swap",
          durationMs: 12400,
        })}
        order={0}
        active={false}
        animate={false}
      />,
    );
    expect(rowOf(container).dataset.open).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(rowOf(container).dataset.open).toBe("false");
    expect(rowOf(container)).toHaveTextContent("staged 1 swap");
  });

  it("renders a structured child return as a readable preview", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          status: "completed",
          message: JSON.stringify({
            fees: "~$0.0053 gas; $0.0001 route fee",
            output: "0.0000265986 WETH",
          }),
          stagedCount: 2,
          durationMs: 153000,
        })}
        order={0}
        active={false}
        animate={false}
      />,
    );

    const summary = container.querySelector(".aui-working-agent-summary");
    expect(summary).toHaveTextContent(
      "Fees: ~$0.0053 gas; $0.0001 route fee · Output: 0.0000265986 WETH",
    );
    expect(summary?.querySelector("svg.lucide-layers")).toBeNull();
    expect(summary).not.toHaveTextContent('{"fees"');
  });

  it("uses the full returned note when the completion preview was truncated", () => {
    const state = makeRun({
      status: "completed",
      message: '{"input":"0.000058926935921387 WETH","output":"0.109671 USDC…',
      steps: [
        {
          kind: "tool_call",
          toolName: "get_account_info",
          childSeq: 1,
        },
        {
          kind: "tool_call",
          toolName: "thread_return",
          childSeq: 2,
        },
        {
          kind: "note",
          text: JSON.stringify({
            input: "0.000058926935921387 WETH",
            output: "0.109671 USDC",
            minimum: "0.109122 USDC",
          }),
          childSeq: 3,
        },
      ],
      stagedCount: 2,
      durationMs: 156000,
    });
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={state}
        order={0}
        active={false}
        animate={false}
      />,
    );

    const summary = container.querySelector(".aui-working-agent-summary");
    expect(summary).toHaveTextContent(
      "Input: 0.000058926935921387 WETH · Output: 0.109671 USDC · Minimum: 0.109122 USDC",
    );
    expect(summary?.querySelector("svg.lucide-layers")).toBeNull();

    const visible = visibleAgentSteps(state);
    expect(visible[visible.length - 1]).toMatchObject({
      kind: "note",
      text: "Input: 0.000058926935921387 WETH · Output: 0.109671 USDC · Minimum: 0.109122 USDC",
    });
    expect(
      container.querySelectorAll(".aui-working-agent-rail .aui-working-note"),
    ).toHaveLength(1);
  });

  it("extracts an explicitly named summary from a structured child return", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          status: "completed",
          message: JSON.stringify({ summary: "Simulation passed" }),
        })}
        order={0}
        active={false}
        animate={false}
      />,
    );

    expect(
      container.querySelector(".aui-working-agent-summary"),
    ).toHaveTextContent("Simulation passed");
    expect(
      container.querySelectorAll(".aui-working-agent-rail .aui-working-note"),
    ).toHaveLength(1);
  });

  it("never auto-changes a row the reader has toggled", () => {
    const { container, rerender } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun()}
        order={0}
        active
        animate={false}
      />,
    );

    fireEvent.click(
      container.querySelector<HTMLElement>(".aui-working-agent-header")!,
    );
    expect(rowOf(container).dataset.open).toBe("false");

    // Still live, more steps land: the row is not re-expanded.
    rerender(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          steps: [{ kind: "note", text: "Looking up the mint", childSeq: 1 }],
        })}
        order={0}
        active
        animate={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(rowOf(container).dataset.open).toBe("false");
  });

  it("keeps a reader-opened finished row open", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({ status: "completed", durationMs: 4000 })}
        order={0}
        active={false}
        animate={false}
      />,
    );
    // Terminal at mount (scrollback) starts folded.
    expect(rowOf(container).dataset.open).toBe("false");

    fireEvent.click(
      container.querySelector<HTMLElement>(".aui-working-agent-header")!,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rowOf(container).dataset.open).toBe("true");
  });

  it("marks a completed run with a check and a failed one with an X", () => {
    const completed = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({ status: "completed" })}
        order={0}
        active={false}
        animate={false}
      />,
    );
    expect(
      completed.container.querySelector(".text-aomi-success"),
    ).not.toBeNull();
    expect(completed.container.querySelector(".text-aomi-danger")).toBeNull();

    for (const status of ["failed", "stalled", "cancelled"] as const) {
      const failed = render(
        <WorkingAgent
          agentId="a"
          run={makeRun({ status })}
          order={0}
          active={false}
          animate={false}
        />,
      );
      expect(
        failed.container.querySelector(".text-aomi-danger"),
      ).not.toBeNull();
      failed.unmount();
    }
  });

  it("renders child steps behind the rail and counts them", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          steps: [
            { kind: "note", text: "Fetching a quote", childSeq: 1 },
            {
              kind: "tool_call",
              toolName: "get_chain_context",
              args: { chain_id: 1 },
              resultPreview: '{"chain_id":1,"block_number":7}',
              childSeq: 2,
            },
          ],
          status: "completed",
          stepCount: 2,
          durationMs: 3000,
        })}
        order={0}
        active={false}
        animate={false}
      />,
    );

    const rail = container.querySelector(".aui-working-agent-rail");
    expect(rail).not.toBeNull();
    expect(rail?.querySelectorAll(".aui-working-step")).toHaveLength(1);
    expect(rail?.querySelectorAll(".aui-working-note")).toHaveLength(1);
    // Notes render but are not steps: the count is visible tool calls only,
    // matching the backend's "steps = tool_call activities" semantics.
    expect(
      container.querySelector(".aui-working-agent-count")?.textContent,
    ).toBe("1 step · 3s");
  });

  it("hides protocol plumbing from the rail", () => {
    const { container } = render(
      <WorkingAgent
        agentId="a"
        run={makeRun({
          steps: [
            {
              kind: "tool_call",
              toolName: "get_chain_context",
              childSeq: 1,
            },
            { kind: "note", text: '{"staged":[{"tx_id":1}]}', childSeq: 2 },
            {
              kind: "tool_call",
              toolName: "thread_return",
              args: { status: "completed" },
              childSeq: 3,
            },
          ],
          status: "completed",
          stepCount: 3,
          durationMs: 2000,
        })}
        order={0}
        active={false}
        animate={false}
      />,
    );

    // thread_return and raw-JSON "notes" are internal — neither rendered
    // nor counted.
    const rail = container.querySelector(".aui-working-agent-rail");
    expect(rail?.querySelectorAll(".aui-working-step")).toHaveLength(1);
    expect(rail?.querySelectorAll(".aui-working-note")).toHaveLength(0);
    expect(
      container.querySelector(".aui-working-agent-count")?.textContent,
    ).toBe("1 step · 2s");
  });

  it("degrades to the transcript part when there is no sidecar", () => {
    const tool = {
      type: "tool-call",
      toolCallId: "tool_1",
      toolName: "task",
      args: { label: "approvals-auditor", app: "default", prompt: "audit" },
      result: {
        agent_id: "task-agent:9f2c1a2b3c4d",
        status: "completed",
        staged_count: 2,
      },
    } as unknown as ToolCallMessagePart;

    const { container } = render(
      <WorkingAgent
        agentId="task-agent:9f2c1a2b3c4d"
        tool={tool}
        order={1}
        active={false}
        animate={false}
      />,
    );

    const row = rowOf(container);
    expect(row.dataset.live).toBe("false");
    expect(row).toHaveTextContent("approvals-auditor");
    expect(row).toHaveTextContent("Staged 2");
    expect(
      container.querySelector(".aui-working-agent-staged-icon"),
    ).not.toBeNull();
    expect(
      container.querySelector(".aui-working-agent-rail")?.children.length,
    ).toBe(0);
  });
});
