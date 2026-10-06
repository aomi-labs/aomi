import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessage,
} from "@assistant-ui/react";
import type { Event, SessionSnapshot, TurnState } from "@aomi-labs/client";
import { projectRuntimeMessages } from "../../../../../packages/react/src/runtime/utils";
import {
  callbackEvents,
  callbackFinalText,
  callbackRoot,
  callbackTurn,
} from "../../../../../tests/fixtures/commit-callback-events";

const transport = vi.hoisted(() => ({
  events: [] as Event[],
  turnState: "complete" as TurnState,
  terminalTurns: [] as NonNullable<SessionSnapshot["terminalTurns"]>,
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => transport,
  useThreadTaskRuns: () => ({}),
}));
vi.mock("@/components/assistant-ui/markdown-text", async () => {
  const { useMessagePartText } = await vi.importActual<
    typeof import("@assistant-ui/react")
  >("@assistant-ui/react");
  return { MarkdownText: () => <span>{useMessagePartText().text}</span> };
});
import { AssistantTurnParts } from "./working-trace";

function AssistantMessage() {
  const metadata = useMessage((message) => message.metadata?.custom);
  return (
    <MessagePrimitive.Root>
      <AssistantTurnParts />
      <pre data-testid="projected-metadata">{JSON.stringify(metadata)}</pre>
    </MessagePrimitive.Root>
  );
}
function Fixture() {
  const messages = projectRuntimeMessages(
    transport.events,
    undefined,
    [],
    undefined,
    transport.terminalTurns,
  );
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    onNew: async () => {},
    convertMessage: (message) => message,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{ UserMessage: () => null, AssistantMessage }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
afterEach(cleanup);

describe("WorkingTrace scoped terminal ACK", () => {
  it("settles an owned callback from its bounded ACK while raw callback history remains processing", async () => {
    transport.events = callbackEvents.filter((event) => event.sequence < 32);
    transport.turnState = "complete";
    transport.terminalTurns = [{ turnId: callbackTurn, state: "complete" }];
    const view = render(<Fixture />);
    await waitFor(() =>
      expect(screen.getByText(/^Worked/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(
      view.container.querySelector(".aui-working-answer")?.textContent,
    ).toBe(callbackFinalText);
    expect(
      JSON.parse(screen.getByTestId("projected-metadata").textContent!),
    ).toMatchObject({
      aomiResponseMessageKey: `${callbackTurn}:response`,
      aomiContinuationTurnStates: { [callbackTurn]: "complete" },
    });
    expect(
      transport.events.findLast(
        (event) =>
          event.type === "turn_state_changed" && event.turn_id === callbackTurn,
      ),
    ).toMatchObject({ state: "processing" });
  });

  it("keeps a failed owned callback visibly failed after a newer turn starts", async () => {
    transport.events = [
      ...callbackEvents.filter((event) => event.sequence < 32),
      {
        type: "message",
        event_id: "new-request",
        sequence: 33,
        occurred_at: 33,
        turn_id: "new-turn",
        sender: "user",
        content: "New question",
        message_key: "new-user",
      },
      {
        type: "turn_state_changed",
        event_id: "new-processing",
        sequence: 34,
        occurred_at: 34,
        turn_id: "new-turn",
        state: "processing",
      },
    ];
    transport.turnState = "processing";
    transport.terminalTurns = [{ turnId: callbackTurn, state: "failed" }];
    const view = render(<Fixture />);
    await waitFor(() =>
      expect(screen.getByText(/^Failed/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Worked/)).not.toBeInTheDocument();
    expect(view.container.querySelector(".aui-working-answer")).toBeNull();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("projected-metadata").textContent!),
    ).toMatchObject({
      aomiContinuationTurnStates: { [callbackTurn]: "failed" },
    });
    expect(
      transport.events.some(
        (event) =>
          event.type === "turn_state_changed" &&
          event.turn_id === callbackRoot &&
          event.state === "complete",
      ),
    ).toBe(true);
  });
});
