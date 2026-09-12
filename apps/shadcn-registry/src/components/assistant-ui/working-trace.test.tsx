import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import { CircleIcon } from "lucide-react";

import type { TaskRunState } from "@aomi-labs/react";

vi.mock("@/components/assistant-ui/markdown-text", async () => {
  const { useMessagePartText } = await vi.importActual<
    typeof import("@assistant-ui/react")
  >("@assistant-ui/react");
  return {
    MarkdownText: () => {
      const part = useMessagePartText();
      return <span data-testid="rendered-text">{part.text}</span>;
    },
  };
});

import {
  buildTraceItems,
  MinimalWorkingTrace,
  RenderedText,
  WorkingTrace,
} from "./working-trace";
import { ToolStepRow } from "./working-trace-rows";

const run = (steps: TaskRunState["steps"]): TaskRunState => ({
  agentId: "task-agent:9f2c1a2b3c4d",
  callId: "call-1",
  label: "swap-worker",
  app: "default",
  status: "running",
  startedAt: Date.now(),
  steps,
});

describe("WorkingTrace", () => {
  it("animates only badges that arrive on an existing live row", () => {
    const base = {
      icon: CircleIcon,
      title: "Commit transactions",
      confidence: "high" as const,
      rawLabel: "evm_commit_txs",
      failed: false,
    };
    const { getByText, rerender } = render(
      <ToolStepRow
        interpretation={{ ...base, chips: [{ label: "Pending" }] }}
        done={false}
        active
        animate={false}
        animateUpdates
      />,
    );

    expect(getByText("Pending").parentElement).not.toHaveClass("animate-in");

    rerender(
      <ToolStepRow
        interpretation={{
          ...base,
          chips: [{ label: "Base" }, { label: "Pending" }],
        }}
        done
        active={false}
        animate={false}
        animateUpdates
      />,
    );

    expect(getByText("Base").parentElement).toHaveClass("animate-in");
    expect(getByText("Pending").parentElement).not.toHaveClass("animate-in");

    rerender(
      <ToolStepRow
        interpretation={{
          ...base,
          chips: [{ label: "Base" }, { label: "Success" }],
        }}
        done
        active={false}
        animate={false}
        animateUpdates
      />,
    );

    expect(getByText("Base").parentElement).not.toHaveClass("animate-in");
    expect(getByText("Success").parentElement).toHaveClass("animate-in");

    rerender(
      <ToolStepRow
        interpretation={{
          ...base,
          chips: [{ label: "Base" }, { label: "Success" }],
        }}
        done
        active={false}
        animate={false}
        animateUpdates
      />,
    );

    expect(getByText("Base").parentElement).not.toHaveClass("animate-in");
    expect(getByText("Success").parentElement).not.toHaveClass("animate-in");

    rerender(
      <ToolStepRow
        interpretation={{
          ...base,
          chips: [
            { label: "Base" },
            { label: "21,000 gas" },
            { label: "Success" },
          ],
        }}
        done
        active={false}
        animate={false}
      />,
    );

    expect(getByText("21,000 gas").parentElement).not.toHaveClass("animate-in");
  });

  it("uses a compact status pill before trace steps arrive", () => {
    const { container, getByRole } = render(<MinimalWorkingTrace />);

    expect(getByRole("status", { name: "Aomi is thinking" })).toHaveTextContent(
      "Thinking",
    );
    expect(container.querySelector(".aui-working-trace-start")).toHaveClass(
      "h-8",
      "w-fit",
      "rounded-full",
      "pl-3",
      "pr-4",
      "border-aomi-border",
      "bg-aomi-surface",
    );
    expect(container.querySelector(".aui-working-trace-start")).not.toHaveClass(
      "h-9",
      "px-3",
      "-mt-px",
    );
    expect(container.querySelector(".aui-working-shimmer")).toHaveClass(
      "text-[13px]",
      "font-medium",
      "leading-none",
    );
    expect(container.querySelector(".aui-working-shimmer")).not.toHaveClass(
      "-top-px",
    );
    expect(container.querySelector(".aui-thinking-glyph")).toBeTruthy();
    expect(container.querySelector(".aui-thinking-bulb")).toBeTruthy();
    expect(container.querySelector(".aui-working-glyph")).toBeNull();
    expect(container.querySelector(".aui-working-trace")).toBeNull();
    expect(getByRole("status")).toHaveTextContent(/^Thinking$/);
  });

  it("keeps Thinking and collapsed Worked chips the same size", () => {
    const { getByRole } = render(
      <>
        <MinimalWorkingTrace />
        <WorkingTrace running={false} items={[]} revealed={0} />
      </>,
    );

    const thinking = getByRole("status", { name: "Aomi is thinking" });
    const worked = getByRole("button", { name: /Worked it out/ });
    for (const className of [
      "h-8",
      "w-fit",
      "rounded-full",
      "pl-3",
      "pr-4",
      "border-aomi-border",
      "bg-aomi-surface",
    ]) {
      expect(thinking).toHaveClass(className);
      expect(worked).toHaveClass(className);
    }
  });

  it("shows completed duration as whole seconds", () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const { getByRole, rerender } = render(
        <WorkingTrace
          running
          items={[]}
          revealed={0}
          startedAtMs={now - 6400}
        />,
      );

      rerender(
        <WorkingTrace
          running={false}
          items={[]}
          revealed={0}
          startedAtMs={now - 6400}
        />,
      );

      expect(getByRole("button", { name: /Worked for/ })).toHaveTextContent(
        "Worked for 6s",
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("renders received text immediately without synthetic typing", () => {
    const { getByTestId, rerender } = render(
      <RenderedText text="First text" />,
    );
    expect(getByTestId("rendered-text")).toHaveTextContent("First text");
    rerender(<RenderedText text="First text, now extended" />);
    expect(getByTestId("rendered-text")).toHaveTextContent(
      "First text, now extended",
    );
  });

  it("uses Working without exposing the internal execution mode", () => {
    const { container, getByText } = render(
      <WorkingTrace running items={[]} revealed={0} />,
    );

    expect(container).toHaveTextContent("Working");
    expect(getByText("Working")).toHaveClass(
      "text-[13px]",
      "font-medium",
      "leading-none",
      "aui-working-shimmer",
    );
    expect(container).not.toHaveTextContent(/orchestrat/i);
    expect(container.querySelector(".aui-working-glyph")).toBeTruthy();
    expect(container.querySelector(".aui-working-cog")).toBeTruthy();
    expect(container.querySelector(".aui-thinking-glyph")).toBeNull();
    expect(container).not.toHaveTextContent("0 steps");
  });

  it("keeps the trace body mounted while animating it open and closed", () => {
    const { container, getByRole } = render(
      <WorkingTrace running items={[]} revealed={0} />,
    );
    const toggle = getByRole("button", { name: /Working/ });
    const body = container.querySelector<HTMLElement>(
      ".aui-working-trace > div",
    )!;

    expect(body).toHaveClass("grid-rows-[1fr]", "opacity-100");
    expect(body).not.toHaveClass("hidden");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(body).toHaveClass("grid-rows-[0fr]", "opacity-0");
    expect(body).not.toHaveClass("hidden");
    expect(body).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).toHaveClass("grid-rows-[1fr]", "opacity-100");
  });

  it("stays open until final-answer playback is ready", () => {
    vi.useFakeTimers();
    try {
      const { getByRole, rerender } = render(
        <WorkingTrace running items={[]} revealed={0} collapseReady={false} />,
      );

      rerender(
        <WorkingTrace
          running={false}
          items={[]}
          revealed={0}
          collapseReady={false}
        />,
      );
      act(() => vi.advanceTimersByTime(1_000));
      expect(getByRole("button", { name: /Worked/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      rerender(
        <WorkingTrace running={false} items={[]} revealed={0} collapseReady />,
      );
      act(() => vi.advanceTimersByTime(500));
      expect(getByRole("button", { name: /Worked/ })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows nested subagent steps while the trace is pinned to latest", () => {
    const item = (state: TaskRunState) => ({
      kind: "agent" as const,
      agentId: state.agentId,
      run: state,
      order: 0,
      key: state.agentId,
    });
    const initialRun = run([]);
    const { container, rerender } = render(
      <WorkingTrace running items={[item(initialRun)]} revealed={1} />,
    );
    const viewport = container.querySelector<HTMLElement>(
      ".aui-working-trace-viewport",
    )!;
    const body = container.querySelector<HTMLElement>(
      ".aui-working-trace-body",
    )!;
    const setScrollTop = vi.fn();
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, get: () => 640 },
      scrollTop: { configurable: true, get: () => 0, set: setScrollTop },
    });
    Object.defineProperty(body, "offsetHeight", {
      configurable: true,
      get: () => 640,
    });

    const updatedRun = run([
      {
        kind: "tool_call",
        toolName: "get_chain_context",
        args: null,
        resultPreview: "",
        childSeq: 1,
      },
    ]);
    rerender(<WorkingTrace running items={[item(updatedRun)]} revealed={1} />);

    expect(setScrollTop).toHaveBeenCalledWith(640);
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(container).toHaveTextContent("Show all 2 steps");
  });

  it("keeps a failed delegation at its transcript position after recovery", () => {
    const failedRun: TaskRunState = {
      ...run([]),
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
    } satisfies ToolCallMessagePart;
    const recoveredCommit = {
      type: "tool-call" as const,
      argsText: "{}",
      toolCallId: "call-2",
      toolName: "commit",
      args: {},
      result: { status: "completed" },
    } satisfies ToolCallMessagePart;

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
    const failedRun: TaskRunState = {
      ...run([]),
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
    } satisfies ToolCallMessagePart;

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
    const first: TaskRunState = {
      ...run([]),
      agentId: "task-agent:first",
      callId: "call-batch:1",
    };
    const second: TaskRunState = {
      ...run([]),
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
    } satisfies ToolCallMessagePart;

    const items = buildTraceItems([delegatedTask], [first, second]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.kind === "agent" && item.agentId)).toEqual([
      first.agentId,
      second.agentId,
    ]);
  });

  it("keeps repeated child invocations distinct without borrowing the latest state", () => {
    const latest = { ...run([]), callId: "second-call" };
    const task = (toolCallId: string): ToolCallMessagePart =>
      ({
        type: "tool-call",
        argsText: "{}",
        toolCallId,
        toolName: "task",
        args: {},
        result: { agent_id: latest.agentId, status: "completed" },
      }) satisfies ToolCallMessagePart;
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
    const latest = { ...run([]), agentId: "child-b", callId: "batch:2" };
    const task = {
      type: "tool-call",
      argsText: "{}",
      toolCallId: "batch",
      toolName: "task",
      args: {},
      result: { results: [{ agent_id: "child-a" }, { agent_id: "child-b" }] },
    } satisfies ToolCallMessagePart;
    const items = buildTraceItems([task], [latest]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ agentId: "child-a", run: undefined });
    expect(items[1]).toMatchObject({ agentId: "child-b", run: latest });
  });

  it("keeps a live child key stable when its transcript arrives", () => {
    const latest = run([]);
    const task = {
      type: "tool-call",
      argsText: "{}",
      toolCallId: latest.callId,
      toolName: "task",
      args: {},
      result: { agent_id: latest.agentId },
    } satisfies ToolCallMessagePart;
    expect(buildTraceItems([task], [latest])[0]?.key).toBe(
      buildTraceItems([], [latest])[0]?.key,
    );
  });
});
