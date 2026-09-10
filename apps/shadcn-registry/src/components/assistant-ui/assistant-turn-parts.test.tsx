import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallMessagePart } from "@assistant-ui/react";

const state = vi.hoisted(() => ({
  running: true,
  turnState: "processing",
  includeTool: true,
  answerText: "",
  isLast: true,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react")>()),
  useMessage: (selector: (message: unknown) => unknown) =>
    selector({
      content: [
        ...(state.includeTool
          ? [
              {
                type: "tool-call",
                argsText: "{}",
                toolName: "commit",
                toolCallId: "call-1",
                args: {},
                result: { status: "completed" },
              } satisfies ToolCallMessagePart,
            ]
          : []),
        ...(state.answerText
          ? [{ type: "text" as const, text: state.answerText }]
          : []),
      ],
      status: { type: state.running ? "running" : "complete" },
      isLast: state.isLast,
    }),
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => ({ turnState: state.turnState }),
  useThreadTaskRuns: () => ({}),
}));

vi.mock("@/components/assistant-ui/markdown-text", () => ({
  MarkdownText: () => null,
}));

vi.mock(
  "@/components/assistant-ui/working-trace-rows",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/components/assistant-ui/working-trace-rows")
    >()),
    prefersReducedMotion: () => true,
  }),
);

import { AssistantTurnParts } from "./working-trace";

afterEach(cleanup);
beforeEach(() => {
  state.running = true;
  state.turnState = "processing";
  state.includeTool = true;
  state.answerText = "";
  state.isLast = true;
});

describe("AssistantTurnParts lifecycle", () => {
  it("keeps completed tool work green", () => {
    const view = render(<AssistantTurnParts />);

    act(() => {
      state.running = false;
      state.turnState = "complete";
    });
    view.rerender(<AssistantTurnParts />);

    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
    expect(view.container.querySelector(".text-aomi-success")).toBeTruthy();
    expect(view.queryByText(/stopped before it could finish/i)).toBeNull();
  });

  it.each(["failed", "interrupted"])(
    "stops Working honestly after a tool-only turn becomes %s",
    (terminal) => {
      state.running = true;
      state.turnState = "processing";
      const view = render(<AssistantTurnParts />);
      expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();

      act(() => {
        state.running = false;
        state.turnState = terminal;
      });
      view.rerender(<AssistantTurnParts />);

      expect(view.queryByRole("button", { name: /Working/ })).toBeNull();
      expect(view.getByRole("button", { name: /Stopped/ })).toBeTruthy();
      if (terminal === "failed") {
        expect(view.container.querySelector(".text-aomi-danger")).toBeTruthy();
        expect(
          view.getByText(/this run stopped before it could finish/i),
        ).toBeTruthy();
      } else {
        expect(view.queryByText(/stopped before it could finish/i)).toBeNull();
      }
    },
  );

  it("keeps partial prose and appends the failed-turn fallback", () => {
    state.running = false;
    state.turnState = "failed";
    state.answerText = "I approved the token spend.";

    const view = render(<AssistantTurnParts />);

    expect(
      view.getByText(/this run stopped before it could finish/i),
    ).toBeTruthy();
  });

  it("shows the failed-turn fallback without a tool trace", () => {
    state.running = false;
    state.turnState = "failed";
    state.includeTool = false;
    state.answerText = "I started the request.";

    const view = render(<AssistantTurnParts />);

    expect(view.queryByRole("button")).toBeNull();
    expect(
      view.getByText(/this run stopped before it could finish/i),
    ).toBeTruthy();
  });

  it("shows the failed-turn fallback when the turn has no usable content", () => {
    state.running = false;
    state.turnState = "failed";
    state.includeTool = false;

    const view = render(<AssistantTurnParts />);

    expect(view.queryByRole("button")).toBeNull();
    expect(
      view.getByText(/this run stopped before it could finish/i),
    ).toBeTruthy();
  });

  it("defers to a following durable notice instead of duplicating fallback copy", () => {
    state.running = false;
    state.turnState = "failed";
    state.isLast = false;

    const view = render(<AssistantTurnParts />);

    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
    expect(view.queryByText(/stopped before it could finish/i)).toBeNull();
  });

  it.each(["awaiting_action", "processing"])(
    "keeps a tool-only turn live during %s",
    (turnState) => {
      state.running = true;
      state.turnState = "processing";
      const view = render(<AssistantTurnParts />);
      state.running = false;
      state.turnState = turnState;
      view.rerender(<AssistantTurnParts />);
      expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();
    },
  );
});
