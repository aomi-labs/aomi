import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  MinimalWorkingTrace,
  ProgressiveRenderedText,
  WorkingTrace,
} from "./working-trace";

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
  it("uses a compact status pill before trace steps arrive", () => {
    const { container, getByRole } = render(<MinimalWorkingTrace />);

    expect(getByRole("status", { name: "Aomi is thinking" })).toHaveTextContent(
      "Thinking",
    );
    expect(container.querySelector(".aui-working-trace-start")).toHaveClass(
      "h-8",
      "w-fit",
      "rounded-full",
      "pr-4",
      "pl-3",
    );
    expect(container.querySelector(".aui-working-shimmer")).toHaveClass(
      "text-[13px]",
      "font-medium",
      "leading-none",
    );
    expect(container.querySelector(".aui-working-live")).toBeTruthy();
    expect(container.querySelector(".aui-working-trace")).toBeNull();
    expect(getByRole("status")).toHaveTextContent(/^Thinking$/);
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
          orchestrating={false}
          startedAtMs={now - 6400}
        />,
      );

      rerender(
        <WorkingTrace
          running={false}
          items={[]}
          revealed={0}
          orchestrating={false}
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

  it("progressively reveals a buffered final answer", async () => {
    vi.useFakeTimers();
    try {
      const answer = "A buffered final answer should arrive progressively.";
      const { getByTestId } = render(
        <ProgressiveRenderedText text={answer} animate />,
      );
      const rendered = getByTestId("rendered-text");

      expect(rendered).toHaveTextContent("");

      act(() => vi.advanceTimersByTime(20));
      expect(rendered.textContent?.length).toBeGreaterThan(0);
      expect(rendered.textContent?.length).toBeLessThan(answer.length);

      for (let tick = 0; tick < 75; tick += 1) {
        await act(() => vi.advanceTimersByTimeAsync(20));
      }
      expect(rendered).toHaveTextContent(answer);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses Working while the orchestrator badge identifies the mode", () => {
    const { container, getByText } = render(
      <WorkingTrace running items={[]} revealed={0} orchestrating />,
    );

    expect(container).toHaveTextContent("Working");
    expect(getByText("Working")).toHaveClass(
      "text-[13px]",
      "font-medium",
      "leading-none",
    );
    expect(container).toHaveTextContent("orchestrator");
    expect(container).not.toHaveTextContent("Orchestrating");
    expect(container.querySelector(".aui-working-live")).toBeTruthy();
    expect(container).not.toHaveTextContent("0 steps");
  });

  it("keeps the trace body mounted while animating it open and closed", () => {
    const { container, getByRole } = render(
      <WorkingTrace running items={[]} revealed={0} orchestrating={false} />,
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
      <WorkingTrace
        running
        items={[item(initialRun)]}
        revealed={1}
        orchestrating
      />,
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
    rerender(
      <WorkingTrace
        running
        items={[item(updatedRun)]}
        revealed={1}
        orchestrating
      />,
    );

    expect(setScrollTop).toHaveBeenCalledWith(640);
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(container).toHaveTextContent("Show all 2 steps");
  });
});
