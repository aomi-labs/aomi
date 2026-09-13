import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallMessagePart } from "@assistant-ui/react";

const state = vi.hoisted(() => ({
  running: true,
  turnState: "processing",
  includeTool: true,
  answerText: "",
  prefixText: "",
  middleText: "",
  secondTool: false,
  isLast: true,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react")>()),
  useMessage: (selector: (message: unknown) => unknown) =>
    selector({
      content: [
        ...(state.prefixText
          ? [{ type: "text" as const, text: state.prefixText }]
          : []),
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
        ...(state.middleText
          ? [{ type: "text" as const, text: state.middleText }]
          : []),
        ...(state.secondTool
          ? [
              {
                type: "tool-call",
                argsText: "{}",
                toolName: "commit",
                toolCallId: "call-2",
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

vi.mock("@/components/assistant-ui/markdown-text", async () => {
  const { useMessagePartText } = await vi.importActual<
    typeof import("@assistant-ui/react")
  >("@assistant-ui/react");
  return { MarkdownText: () => <span>{useMessagePartText().text}</span> };
});

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
  state.prefixText = "";
  state.middleText = "";
  state.secondTool = false;
  state.isLast = true;
});

describe("AssistantTurnParts lifecycle", () => {
  it("keeps working prose in one trace and the completed answer outside it", () => {
    state.includeTool = false;
    state.prefixText = "Your balance is 10 ETH.";
    const view = render(<AssistantTurnParts />);
    const original = view.getByText(state.prefixText);
    expect(original).toBeVisible();
    state.includeTool = true;
    state.answerText = "The transfer needs your approval.";
    view.rerender(<AssistantTurnParts />);
    const trace = view.container.querySelector(".aui-working-trace");
    expect(trace).toContainElement(view.getByText(state.prefixText));
    expect(trace).toContainElement(view.getByText(state.answerText));
    expect(view.container.querySelectorAll(".aui-working-trace")).toHaveLength(
      1,
    );
    expect(
      original.compareDocumentPosition(view.getByText(state.answerText)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      state.running = false;
      state.turnState = "complete";
    });
    view.rerender(<AssistantTurnParts />);
    expect(trace).toContainElement(view.getByText(state.prefixText));
    expect(trace).not.toContainElement(view.getByText(state.answerText));
    expect(
      view.getByText(state.answerText).closest(".aui-working-answer"),
    ).toBeTruthy();
  });

  it("places notes before and between tools in a single chronological trace", () => {
    state.prefixText = "Checking the balance.";
    state.middleText = "The balance read failed; retrying.";
    state.secondTool = true;
    state.answerText = "Withdrawal completed.";
    state.running = false;
    state.turnState = "complete";
    const view = render(<AssistantTurnParts />);
    const trace = view.container.querySelector(".aui-working-trace");
    expect(view.container.querySelectorAll(".aui-working-trace")).toHaveLength(
      1,
    );
    expect(trace?.querySelectorAll(".aui-working-note")).toHaveLength(2);
    expect(trace?.querySelectorAll(".aui-working-step")).toHaveLength(2);
    expect(trace).toContainElement(view.getByText(state.prefixText));
    expect(trace).toContainElement(view.getByText(state.middleText));
    expect(trace).not.toContainElement(view.getByText(state.answerText));
  });

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
