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
  trailingTool: false,
  isLast: true,
  messageId: "turn:turn-1",
  events: [] as unknown[],
  finalAnswerStartIndex: undefined as number | undefined,
  continuationTurnIds: [] as string[],
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react")>()),
  useMessage: (selector: (message: unknown) => unknown) =>
    selector({
      id: state.messageId,
      metadata: {
        custom: {
          aomiFinalAnswerStartIndex: state.finalAnswerStartIndex,
          aomiContinuationTurnIds: state.continuationTurnIds,
        },
      },
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
        ...(state.trailingTool
          ? [
              {
                type: "tool-call",
                argsText: "{}",
                toolName: "receipt",
                toolCallId: "late-receipt",
                args: {},
                result: { status: "completed" },
              } satisfies ToolCallMessagePart,
            ]
          : []),
      ],
      status: { type: state.running ? "running" : "complete" },
      isLast: state.isLast,
    }),
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => ({
    turnState: state.turnState,
    events: state.events,
  }),
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
  state.trailingTool = false;
  state.isLast = true;
  state.messageId = "turn:turn-1";
  state.events = [];
  state.finalAnswerStartIndex = undefined;
  state.continuationTurnIds = [];
});

describe("AssistantTurnParts lifecycle", () => {
  it("keeps working prose in one trace and the completed answer outside it", () => {
    state.includeTool = false;
    state.prefixText = "Your balance is 10 ETH.";
    const view = render(<AssistantTurnParts />);
    const original = view.getByText(state.prefixText);
    expect(original).toBeVisible();
    const initialTrace = view.container.querySelector(".aui-working-trace");
    expect(initialTrace).toContainElement(original);
    expect(view.container.querySelector(".aui-working-answer")).toBeNull();
    state.prefixText += " Checking whether it can be transferred.";
    view.rerender(<AssistantTurnParts />);
    expect(initialTrace).toContainElement(view.getByText(state.prefixText));
    expect(view.container.querySelector(".aui-working-answer")).toBeNull();
    state.includeTool = true;
    state.answerText = "The transfer needs your approval.";
    view.rerender(<AssistantTurnParts />);
    const trace = view.container.querySelector(".aui-working-trace");
    expect(trace).toBe(initialTrace);
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

  it("promotes a text-only reply only when the turn completes", () => {
    state.includeTool = false;
    state.answerText = "Here is the answer.";
    const view = render(<AssistantTurnParts />);
    expect(view.container.querySelector(".aui-working-trace")).toContainElement(
      view.getByText(state.answerText),
    );
    expect(view.container.querySelector(".aui-working-answer")).toBeNull();

    state.running = false;
    view.rerender(<AssistantTurnParts />);
    expect(view.container.querySelector(".aui-working-answer")).toBeNull();

    state.turnState = "complete";
    view.rerender(<AssistantTurnParts />);
    expect(view.container.querySelector(".aui-working-trace")).toBeNull();
    expect(
      view.container.querySelector(".aui-working-answer"),
    ).toHaveTextContent(state.answerText);
    expect(view.getAllByText(state.answerText)).toHaveLength(1);
  });

  it.each([undefined, 3])(
    "shows the completed answer when a tool arrives late and the boundary is %s",
    (boundary) => {
      state.running = false;
      state.turnState = "complete";
      state.answerText = "The move on Arc is complete.";
      state.trailingTool = true;
      state.finalAnswerStartIndex = boundary;

      const view = render(<AssistantTurnParts />);
      const trace = view.container.querySelector(".aui-working-trace");
      const answer = view.getByText(state.answerText);
      expect(trace).not.toContainElement(answer);
      expect(answer.closest(".aui-working-answer")).toBeTruthy();
      expect(trace?.querySelectorAll(".aui-working-step")).toHaveLength(2);
      expect(view.getAllByText(state.answerText)).toHaveLength(1);
    },
  );

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

  it("stays Working from commit through wallet confirmation and callback", () => {
    const callbackId = "broadcast-terminal:batch-1";
    state.continuationTurnIds = [callbackId];
    state.events = [
      { type: "turn_state_changed", turn_id: "turn-1", state: "complete" },
    ];
    state.running = false;
    state.turnState = "complete";
    const view = render(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();

    state.events = [
      ...state.events,
      { type: "turn_state_changed", turn_id: callbackId, state: "processing" },
    ];
    state.turnState = "processing";
    state.finalAnswerStartIndex = 1;
    state.answerText = "Payment confirmed.";
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();
    const trace = view.container.querySelector(".aui-working-trace");
    const answer = view.getByText(state.answerText);
    expect(trace).not.toContainElement(answer);
    expect(answer.closest(".aui-working-answer")).toBeTruthy();

    state.events = [
      ...state.events,
      {
        type: "message",
        turn_id: callbackId,
        message_key: `${callbackId}:response`,
        sender: "agent",
        content: state.answerText,
        is_streaming: false,
      },
      { type: "turn_state_changed", turn_id: callbackId, state: "complete" },
    ];
    state.turnState = "complete";
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
    expect(view.container.querySelector(".aui-working-trace")).toBe(trace);
    expect(view.getByText(state.answerText)).toBe(answer);

    // Completion remains settled when the durable projection rerenders.
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
  });

  it("does not reanimate a completed turn for a later turn's processing", () => {
    state.running = true;
    state.events = [
      { type: "turn_state_changed", turn_id: "turn-1", state: "complete" },
      { type: "turn_state_changed", turn_id: "turn-2", state: "processing" },
    ];
    const view = render(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
  });

  it("keeps an older commit trace live while a later user turn runs", () => {
    state.running = false;
    state.isLast = false;
    state.turnState = "processing";
    state.continuationTurnIds = ["broadcast-terminal:batch-1"];
    state.events = [
      { type: "turn_state_changed", turn_id: "turn-1", state: "complete" },
      { type: "turn_state_changed", turn_id: "turn-2", state: "processing" },
    ];
    const view = render(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();

    state.events = [
      ...state.events,
      {
        type: "turn_state_changed",
        turn_id: "broadcast-terminal:batch-1",
        state: "processing",
      },
    ];
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();

    state.events = [
      ...state.events,
      {
        type: "message",
        turn_id: "broadcast-terminal:batch-1",
        message_key: "broadcast-terminal:batch-1:response",
        sender: "agent",
        content: "Finished.",
        is_streaming: false,
      },
      {
        type: "turn_state_changed",
        turn_id: "broadcast-terminal:batch-1",
        state: "complete",
      },
    ];
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
  });

  it("keeps nested callback work in one trace until the last callback settles", () => {
    const firstCallback = "broadcast-terminal:batch-a";
    const secondCallback = "broadcast-terminal:batch-b";
    state.running = false;
    state.turnState = "complete";
    state.continuationTurnIds = [firstCallback, secondCallback];
    state.middleText = "The first payment finished; approve the second.";
    state.secondTool = true;
    state.answerText = "Both payments finished.";
    state.finalAnswerStartIndex = 3;
    state.events = [
      { type: "turn_state_changed", turn_id: "turn-1", state: "complete" },
      { type: "turn_state_changed", turn_id: firstCallback, state: "complete" },
      {
        type: "turn_state_changed",
        turn_id: secondCallback,
        state: "processing",
      },
    ];
    const view = render(<AssistantTurnParts />);
    const trace = view.container.querySelector(".aui-working-trace");
    const answer = view.getByText(state.answerText);
    expect(view.container.querySelectorAll(".aui-working-trace")).toHaveLength(
      1,
    );
    expect(view.getByRole("button", { name: /Working/ })).toBeTruthy();
    expect(trace?.querySelectorAll(".aui-working-step")).toHaveLength(2);
    expect(trace).toContainElement(view.getByText(state.middleText));
    expect(trace).not.toContainElement(answer);

    state.events = [
      ...state.events,
      {
        type: "message",
        turn_id: secondCallback,
        message_key: `${secondCallback}:response`,
        sender: "agent",
        content: state.answerText,
        is_streaming: false,
      },
      {
        type: "turn_state_changed",
        turn_id: secondCallback,
        state: "complete",
      },
    ];
    view.rerender(<AssistantTurnParts />);
    expect(view.getByRole("button", { name: /Worked/ })).toBeTruthy();
    expect(view.container.querySelector(".aui-working-trace")).toBe(trace);
    expect(view.getByText(state.answerText)).toBe(answer);
  });
});
