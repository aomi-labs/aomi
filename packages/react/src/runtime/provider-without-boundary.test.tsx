import { act, render, screen, waitFor } from "@testing-library/react";
import {
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";
import { AomiRuntimeProvider } from "./aomi-runtime";
import { useAomiRuntime, type AomiRuntimeApi } from "../interface";

function Text() {
  const text = useMessage((message) =>
    message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(""),
  );
  return <MessagePrimitive.Root>{text}</MessagePrimitive.Root>;
}

const reply = (sessionId: string, content: string) =>
  Response.json({
    session_id: sessionId,
    cursor: "2",
    has_more: false,
    started_turn_id: "turn1",
    events: [
      {
        type: "message",
        sender: "agent",
        content,
        message_key: "answer",
        event_id: "event1",
        sequence: 1,
        turn_id: "turn1",
        occurred_at: 1,
      },
      {
        type: "turn_state_changed",
        state: "complete",
        event_id: "event2",
        sequence: 2,
        turn_id: "turn1",
        occurred_at: 1,
      },
    ],
  });

describe("AomiRuntimeProvider without AomiChatBoundary", () => {
  it("renders the open chat's messages and the next chat's after a switch", async () => {
    let runtime!: AomiRuntimeApi;
    function Capture() {
      runtime = useAomiRuntime();
      return null;
    }
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname;
        if (path === "/v1/agent/chat" && init?.method === "POST") {
          const { sessionId, message } = JSON.parse(String(init.body)) as {
            sessionId: string;
            message: string;
          };
          return reply(sessionId, `answer to ${message}`);
        }
        return Response.json([]);
      },
    );
    render(
      <AomiRuntimeProvider
        backendUrl="https://backend.example"
        clientOptions={{ fetch, guest: false }}
        persistThread={false}
        displayPersistence="none"
      >
        <Capture />
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages
            components={{ UserMessage: Text, AssistantMessage: Text }}
          />
        </ThreadPrimitive.Root>
      </AomiRuntimeProvider>,
    );
    await act(() => runtime.sendMessage("first"));
    await waitFor(() =>
      expect(screen.getByText("answer to first")).toBeInTheDocument(),
    );
    await act(() => runtime.createThread());
    await act(() => runtime.sendMessage("second"));
    await waitFor(() =>
      expect(screen.getByText("answer to second")).toBeInTheDocument(),
    );
    expect(screen.queryByText("answer to first")).toBeNull();
  });
});
