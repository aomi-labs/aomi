import { describe, expect, it } from "vitest";
import type { Event, MessageEvent } from "@aomi-labs/client";
import { projectRuntimeMessages } from "./message-projection";

const meta = (sequence: number) => ({
  event_id: `event-${sequence}`,
  sequence,
  occurred_at: sequence,
  turn_id: "turn-1",
});
const update = (
  sequence: number,
  disposition: "accepted" | "applied",
): Event => ({
  ...meta(sequence),
  type: "turn_input",
  input_id: "correction-1",
  operation: "steer",
  disposition,
  input_revision: 2,
  received_at: 1,
  admitted_at: 1,
  applied_at: disposition === "applied" ? 2 : null,
  message: "Use 5 instead",
});
const text = (
  sequence: number,
  revision: number,
  content: string,
): MessageEvent => ({
  ...meta(sequence),
  type: "message",
  sender: "agent",
  content,
  message_key: `response-${revision}`,
  input_revision: revision,
  is_streaming: false,
});
const contents = (events: Event[]) =>
  projectRuntimeMessages(events).map((message) => ({
    id: message.id,
    role: message.role,
    text:
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
  }));

describe("steering transcript projection", () => {
  it("keeps an earlier thinking trace above a follow-up before any output arrives", () => {
    const events: Event[] = [
      {
        ...meta(1),
        type: "message",
        sender: "user",
        content: "Research",
        message_key: "first",
      },
      { ...meta(2), type: "turn_state_changed", state: "processing" },
      update(3, "accepted"),
    ];
    const messages = projectRuntimeMessages(events);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[1]).toMatchObject({
      id: "turn:turn-1",
      content: [],
      metadata: { custom: { aomiTraceClosed: true, aomiTraceEndedAt: 3000 } },
    });
    expect(messages[3]).toMatchObject({
      id: "turn:turn-1:input:2",
      content: [],
      metadata: {
        custom: {
          aomiTraceClosed: false,
          aomiTurnId: "turn-1",
          aomiTraceStartedAt: 3000,
        },
      },
    });
    expect(projectRuntimeMessages(JSON.parse(JSON.stringify(events)))).toEqual(
      messages,
    );
  });

  it("updates an in-flight tool in its original trace after a follow-up", () => {
    const events: Event[] = [
      {
        ...meta(1),
        type: "tool_update",
        id: "call",
        call_id: "call",
        tool_name: "research",
        result: undefined,
      },
      update(2, "accepted"),
      {
        ...meta(3),
        type: "tool_complete",
        id: "call",
        call_id: "call",
        tool_name: "research",
        result: { done: true },
      },
      text(4, 2, "Continuing with 5"),
    ];
    const messages = projectRuntimeMessages(events);
    expect(messages[0]?.content).toMatchObject([
      { type: "tool-call", toolCallId: "call", result: { done: true } },
    ]);
    expect(messages[0]?.metadata?.custom?.aomiTraceClosed).toBe(true);
    expect(messages[2]?.content).toEqual([
      { type: "text", text: "Continuing with 5" },
    ]);
    expect(
      messages
        .flatMap((message) =>
          typeof message.content === "string" ? [] : message.content,
        )
        .filter((part) => part.type === "tool-call"),
    ).toHaveLength(1);
  });

  it("places a pending follow-up after a retained trace without mutating the earlier projection", () => {
    const events: Event[] = [
      {
        ...meta(1),
        type: "message",
        sender: "user",
        content: "Research",
        message_key: "first",
      },
      { ...meta(2), type: "turn_state_changed", state: "processing" },
    ];
    const messages = projectRuntimeMessages(
      events,
      undefined,
      [],
      undefined,
      [],
      undefined,
      [
        {
          inputId: "pending",
          operation: "steer",
          targetTurnId: "turn-1",
          message: "Use 5 instead",
          status: "sending",
        },
      ],
    );
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[1]?.metadata?.custom?.aomiTraceClosed).toBe(true);
    expect(messages[2]?.id).toBe("input:pending");
    expect(projectRuntimeMessages(events)).toHaveLength(1);
  });

  it("segments the revised answer after its correction while retaining completed facts", () => {
    const messages = contents([
      text(1, 1, "Completed research"),
      update(2, "accepted"),
      update(3, "applied"),
      text(4, 2, "Revised plan"),
    ]);
    expect(messages.map((message) => message.text)).toEqual([
      "Completed research",
      "Use 5 instead",
      "Revised plan",
    ]);
    expect(messages.map((message) => message.id)).toEqual([
      "turn:turn-1",
      "input:correction-1",
      "turn:turn-1:input:2",
    ]);
  });

  it("reconciles the accepted input with its installed user message exactly once", () => {
    const installed: MessageEvent = {
      ...meta(4),
      type: "message",
      sender: "user",
      content: "Use 5 instead",
      message_key: "correction-1",
      input_id: "correction-1",
      input_revision: 2,
    };
    const messages = contents([
      text(1, 1, "Research"),
      update(2, "accepted"),
      update(3, "applied"),
      installed,
      text(5, 2, "New plan"),
    ]);
    expect(messages.filter((message) => message.role === "user")).toEqual([
      { id: "input:correction-1", role: "user", text: "Use 5 instead" },
    ]);
  });
});
