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
