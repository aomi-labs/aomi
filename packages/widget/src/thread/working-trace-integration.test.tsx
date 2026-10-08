import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { Event, TurnState } from "@aomi-labs/client";
import {
  logicalTurnRunning,
  projectRuntimeMessages,
} from "../../../react/src/runtime/message-projection";

const transport = vi.hoisted(() => ({
  events: [] as Event[],
  turnState: "complete" as TurnState,
  stoppedTurnId: undefined as string | undefined,
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => transport,
  useThreadTaskRuns: () => ({}),
}));
vi.mock("./markdown-text", async () => {
  const { useMessagePartText } = await vi.importActual<
    typeof import("@assistant-ui/react")
  >("@assistant-ui/react");
  return { MarkdownText: () => <span>{useMessagePartText().text}</span> };
});
import { AssistantTurnParts } from "./working-trace";

function AssistantMessage() {
  return (
    <MessagePrimitive.Root data-testid="assistant-row">
      <AssistantTurnParts />
      <ActionBarPrimitive.Root hideWhenRunning>
        <ActionBarPrimitive.Copy aria-label="Copy" />
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
function Fixture() {
  const messages = projectRuntimeMessages(
    transport.events,
    undefined,
    [],
    transport.stoppedTurnId,
  );
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning:
      !transport.stoppedTurnId &&
      logicalTurnRunning(transport.events, messages, transport.turnState),
    onNew: async () => {},
    convertMessage: (message) => message,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{
            UserMessage: () => null,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

afterEach(() => {
  cleanup();
  transport.stoppedTurnId = undefined;
});

it("keeps Copy hidden and one trace active through receipts and a second-chain commit, then settles", async () => {
  transport.events = [];
  let sequence = 0;
  const append = (turn: string, event: Event) => {
    transport.events = [
      ...transport.events,
      {
        ...event,
        sequence: ++sequence,
        event_id: `event-${sequence}`,
        occurred_at: 1_735_000_000_000 + sequence,
        turn_id: turn,
      },
    ];
    if (event.type === "turn_state_changed") transport.turnState = event.state;
  };
  const state = (turn: string, value: TurnState) =>
    append(turn, {
      type: "turn_state_changed",
      state: value,
    } as Event);
  const admission = (turn: string, batch: string, chain: number) =>
    append(turn, {
      type: "message",
      sender: "agent",
      content: "",
      message_key: `${turn}:commit`,
      tool_name: "evm_commit_txs",
      tool_result: [
        "Commit",
        JSON.stringify({
          commits: [1, 2].map((id) => ({
            commit_id: `${batch}-${id}`,
            batch: { batch_id: batch },
            chain_id: chain,
          })),
        }),
      ],
    } as Event);
  const receipt = (turn: string, batch: string, id: number) =>
    append(turn, {
      type: "tool_complete",
      id: `${batch}-receipt-${id}`,
      call_id: `${batch}-call`,
      tool_name: "evm_commit_txs",
      result: {
        status: "success",
        commit_id: `${batch}-${id}`,
        identifier: { kind: "hash", value: `0x${id}` },
        pending_ids: [{ id, chain: "evm" }],
      },
    } as Event);
  append("turn-1", {
    type: "message",
    sender: "user",
    content: "Move funds across chains",
  } as Event);
  admission("turn-1", "batch-1", 1);
  state("turn-1", "complete");
  const view = render(<Fixture />);
  const expectPaused = () => {
    view.rerender(<Fixture />);
    expect(screen.getAllByTestId("assistant-row")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(screen.getByText("Working")).toBeTruthy();
  };
  expectPaused();
  receipt("turn-1", "batch-1", 1);
  expectPaused();
  receipt("turn-1", "batch-1", 2);
  state("broadcast-terminal:batch-1", "processing");
  expectPaused();
  admission("broadcast-terminal:batch-1", "batch-2", 8453);
  state("broadcast-terminal:batch-1", "complete");
  expectPaused();
  receipt("broadcast-terminal:batch-1", "batch-2", 1);
  receipt("broadcast-terminal:batch-1", "batch-2", 2);
  state("broadcast-terminal:batch-2", "processing");
  expectPaused();
  append("broadcast-terminal:batch-2", {
    type: "message",
    sender: "agent",
    content: "All steps completed.",
    message_key: "broadcast-terminal:batch-2:response",
    is_streaming: false,
  } as Event);
  state("broadcast-terminal:batch-2", "complete");
  view.rerender(<Fixture />);
  expect(screen.getAllByTestId("assistant-row")).toHaveLength(1);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy(),
  );
  expect(screen.queryByText("Working")).toBeNull();
  expect(screen.getByText(/Worked/)).toBeTruthy();
  expect(screen.getByText("All steps completed.")).toBeTruthy();
});

it("renders acknowledged Stop from projected status before the terminal page arrives", async () => {
  transport.events = [
    {
      type: "message",
      sender: "user",
      content: "Explain",
      message_key: "request",
    },
    { type: "turn_state_changed", state: "processing" },
    {
      type: "tool_update",
      id: "search-update",
      call_id: "search-call",
      tool_name: "web_search",
      result: { stage: "started", message: "Checking sources" },
    },
    {
      type: "message",
      sender: "agent",
      content: "Partial answer",
      message_key: "partial",
      is_streaming: true,
    },
  ].map((event, index) => ({
    ...event,
    turn_id: "turn-stop",
    event_id: `stop-${index}`,
    sequence: index + 1,
    occurred_at: index + 1,
  })) as Event[];
  transport.turnState = "interrupted";
  transport.stoppedTurnId = "turn-stop";
  render(<Fixture />);
  await waitFor(() => expect(screen.getByText(/^Stopped/)).toBeInTheDocument());
  expect(screen.queryByText("Working")).not.toBeInTheDocument();
  expect(transport.events.at(-1)?.type).toBe("message");
});

it.each([
  { state: "interrupted", label: "Stopped", otherLabel: "Failed" },
  { state: "failed", label: "Failed", otherLabel: "Stopped" },
])(
  "keeps an older $state trace truthful while a later turn runs and completes",
  async ({ state, label, otherLabel }) => {
    transport.events = [
      {
        type: "message",
        sender: "user",
        content: "First question",
        message_key: "first",
      },
      { type: "turn_state_changed", state: "processing" },
      {
        type: "tool_update",
        id: "first-update",
        call_id: "first-call",
        tool_name: "web_search",
        result: { stage: "started", message: "First search" },
      },
      { type: "turn_state_changed", state },
      {
        type: "message",
        sender: "user",
        content: "Second question",
        message_key: "second",
      },
      { type: "turn_state_changed", state: "processing" },
      {
        type: "tool_update",
        id: "second-update",
        call_id: "second-call",
        tool_name: "web_search",
        result: { stage: "started", message: "Second search" },
      },
    ].map((event, index) => ({
      ...event,
      turn_id: index < 4 ? "first-turn" : "second-turn",
      event_id: `history-${index}`,
      sequence: index + 1,
      occurred_at: index + 1,
    })) as Event[];
    transport.turnState = "processing";
    const view = render(<Fixture />);
    const statusLabel = new RegExp(`^${label}`);
    await waitFor(() =>
      expect(screen.getByText(statusLabel)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(new RegExp(`^${otherLabel}`)),
    ).not.toBeInTheDocument();
    if (state === "failed")
      expect(
        screen.getByText("This run failed before it could finish."),
      ).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getAllByTestId("assistant-row")).toHaveLength(2);

    transport.events = [
      ...transport.events,
      {
        type: "turn_state_changed",
        state: "complete",
        turn_id: "second-turn",
        event_id: "history-complete",
        sequence: 8,
        occurred_at: 8,
      } as Event,
    ];
    transport.turnState = "complete";
    view.rerender(<Fixture />);
    await waitFor(() =>
      expect(screen.getByText(/^Worked/)).toBeInTheDocument(),
    );
    expect(screen.getByText(statusLabel)).toBeInTheDocument();
    expect(
      screen.queryByText(new RegExp(`^${otherLabel}`)),
    ).not.toBeInTheDocument();
  },
);
