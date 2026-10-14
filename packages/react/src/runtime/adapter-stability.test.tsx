import { useContext, useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  useAssistantRuntime,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";
import type { AomiClient, Event, EventPage } from "@aomi-labs/client";
import { AomiRuntimeProvider } from "./aomi-runtime";
import {
  AomiChatBoundary,
  ChatBoundaryContext,
} from "./assistant-runtime-boundary";
import { useAomiRuntime, type AomiRuntimeApi } from "../interface";
import { useAomiDisplayCache } from "../query/display-cache";
import {
  useThreadContext,
  type ThreadContext,
} from "../contexts/thread-context";

const meta = (sequence: number) => ({
  event_id: `event-${sequence}`,
  sequence,
  turn_id: "turn-1",
  occurred_at: sequence,
});
const message = (sequence: number, content: string): Event => ({
  ...meta(sequence),
  type: "message",
  sender: "agent",
  content,
  message_key: "answer",
  is_streaming: false,
});

function setup() {
  let api!: AomiRuntimeApi;
  let client!: AomiClient;
  let threads!: ThreadContext;
  let native!: AssistantRuntime;
  let adapter!: NonNullable<
    React.ContextType<typeof ChatBoundaryContext>
  >["adapter"];
  function Capture() {
    const currentApi = useAomiRuntime();
    const currentClient = useAomiDisplayCache()!.apiClient!;
    const currentThreads = useThreadContext();
    const chat = useContext(ChatBoundaryContext)!;
    useEffect(() => {
      api = currentApi;
      client = currentClient;
      threads = currentThreads;
      adapter = chat.adapter;
    }, [currentApi, currentClient, currentThreads, chat]);
    return null;
  }
  function NativeCapture() {
    const runtime = useAssistantRuntime();
    useEffect(() => {
      native = runtime;
    }, [runtime]);
    return null;
  }
  const fetch = vi.fn(async (input: string | URL | Request) =>
    Response.json(String(input).endsWith("models") ? ["model"] : []),
  );
  const options = { fetch, guest: false as const };
  const frame = (accountId = "account-a") => (
    <AomiRuntimeProvider
      backendUrl="https://controlled.example"
      clientOptions={options}
      persistThread={false}
      initialThreadId="thread-a"
      account={accountId ? { kind: "user", id: accountId } : null}
      displayPersistence="none"
    >
      <Capture />
      <AomiChatBoundary>
        <NativeCapture />
      </AomiChatBoundary>
    </AomiRuntimeProvider>
  );
  const view = render(frame());
  const streams: Parameters<typeof client.agent.stream>[2][] = [];
  vi.spyOn(client.agent, "stream").mockImplementation(
    async (_id, options, frame) => {
      streams.push(frame);
      await new Promise<void>((resolve) =>
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    },
  );
  const page = (
    events: Event[],
    extra: Partial<EventPage> = {},
  ): EventPage => ({
    session_id: api.currentThreadId,
    cursor: String(events.at(-1)?.sequence ?? 0),
    events,
    has_more: false,
    ...extra,
  });
  const start = vi.spyOn(client.agent, "start");
  return {
    view,
    frame,
    page,
    streams,
    start,
    get api() {
      return api;
    },
    get threads() {
      return threads;
    },
    get native() {
      return native;
    },
    get adapter() {
      return adapter;
    },
  };
}

describe("Core's native message converter", () => {
  it("keeps converted history on metadata-only shell updates without losing notifications", async () => {
    const h = setup();
    h.start.mockResolvedValue(
      h.page(
        [
          {
            ...meta(1),
            type: "message",
            sender: "user",
            content: "Explain",
            message_key: "request",
          },
          message(2, "Saved answer"),
          { ...meta(3), type: "turn_state_changed", state: "complete" },
        ],
        { started_turn_id: "turn-1" },
      ),
    );
    await act(() => h.api.sendMessage("Explain"));
    const raw = h.adapter.messages;
    const original = h.native.thread.getState().messages;
    expect(original.at(-1)?.content).toEqual([
      { type: "text", text: "Saved answer" },
    ]);
    const notify = vi.fn();
    const unsubscribe = h.native.thread.subscribe(notify);
    act(() =>
      h.threads.updateThreadMetadata(h.api.currentThreadId, {
        title: "Renamed",
      }),
    );
    expect(h.adapter.messages).toBe(raw);
    expect(h.native.thread.getState().messages).toBe(original);
    expect(notify).toHaveBeenCalled();
    act(() =>
      h.api.showNotification({
        type: "info",
        title: "Notice",
        message: "Visible",
      }),
    );
    expect(h.api.notifications.at(-1)?.title).toBe("Notice");
    expect(h.native.thread.getState().messages).toBe(original);
    expect(h.start).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it.each(["complete", "failed", "interrupted"] as const)(
    "replaces raw and native messages for text, tool arguments/results, urgent %s and a new owner",
    async (terminal) => {
      const h = setup();
      h.start.mockResolvedValue(
        h.page(
          [
            {
              ...meta(1),
              type: "message",
              sender: "user",
              content: "Explain",
              message_key: "request",
            },
            { ...meta(2), type: "turn_state_changed", state: "processing" },
            message(3, "First text"),
          ],
          { started_turn_id: "turn-1" },
        ),
      );
      let send!: Promise<void>;
      act(() => {
        send = h.api.sendMessage("Explain");
      });
      await waitFor(() => expect(h.streams).toHaveLength(1));
      await waitFor(() =>
        expect(h.native.thread.getState().messages.at(-1)?.content).toEqual([
          { type: "text", text: "First text" },
        ]),
      );
      let raw = h.adapter.messages!.at(-1);
      let converted = h.native.thread.getState().messages.at(-1);
      async function deliver(events: Event[]) {
        await act(() => h.streams[0]!("page", h.page(events)));
        expect(h.adapter.messages!.at(-1)).not.toBe(raw);
        expect(h.native.thread.getState().messages.at(-1)).not.toBe(converted);
        raw = h.adapter.messages!.at(-1);
        converted = h.native.thread.getState().messages.at(-1);
      }
      await deliver([message(4, "Changed text")]);
      expect(converted?.content).toEqual([
        { type: "text", text: "Changed text" },
      ]);
      await deliver([
        {
          ...meta(5),
          type: "tool_update",
          id: "tool",
          call_id: "call",
          tool_name: "quote",
          result: { stage: "started" },
        },
      ]);
      expect(converted?.content.at(-1)).toMatchObject({
        type: "tool-call",
        toolCallId: "call",
        toolName: "quote",
      });
      await deliver([
        {
          ...meta(6),
          type: "tool_complete",
          id: "tool",
          call_id: "call",
          tool_name: "quote",
          result: { amount: "1" },
        },
      ]);
      expect(converted?.content.at(-1)).toMatchObject({
        result: { amount: "1" },
      });
      await deliver([
        {
          ...meta(7),
          type: "message",
          sender: "agent",
          content: "",
          message_key: "tool-result",
          tool_call_id: "call",
          tool_name: "quote",
          tool_arguments: { amount: "2" },
          tool_result: ["quote", '{"amount":"2"}'],
        },
      ]);
      expect(converted?.content.at(-1)).toMatchObject({
        toolCallId: "call",
        args: { amount: "2" },
        result: { amount: "2" },
      });
      await deliver([
        { ...meta(8), type: "turn_state_changed", state: "awaiting_action" },
      ]);
      expect(converted?.metadata.custom).toMatchObject({
        aomiTurnState: "awaiting_action",
      });
      await deliver([
        { ...meta(9), type: "turn_state_changed", state: terminal },
      ]);
      expect(converted?.metadata.custom).toMatchObject({
        aomiTurnState: terminal,
      });
      expect(converted?.status).toMatchObject({ type: "complete" });
      expect(h.native.thread.getState().isRunning).toBe(false);
      await act(() => send);
      const former = h.native;
      h.view.rerender(h.frame("account-b"));
      await waitFor(() => expect(h.native).not.toBe(former));
      expect(h.native.thread.getState().messages).toEqual([]);
      expect(h.api.events).toEqual([]);
      expect(h.start).toHaveBeenCalledOnce();
      h.start.mockResolvedValue(
        h.page(
          [
            {
              ...meta(1),
              type: "message",
              sender: "user",
              content: "New owner",
              message_key: "request",
            },
            message(2, "Owner B answer"),
            { ...meta(3), type: "turn_state_changed", state: "complete" },
          ],
          { started_turn_id: "turn-1" },
        ),
      );
      await act(() => h.api.sendMessage("New owner"));
      expect(h.native.thread.getState().messages.at(-1)?.content).toEqual([
        { type: "text", text: "Owner B answer" },
      ]);
    },
  );
});
