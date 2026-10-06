import { describe, expect, it } from "vitest";
import type { Event, MessageEvent } from "../src/agent/types";
import {
  conversationMessages,
  projectConversationEvents,
} from "../src/session/conversation";

function message(
  sequence: number,
  turn: string,
  sender: MessageEvent["sender"],
  content: string,
  key = `${turn}:${sender}`,
): MessageEvent {
  return {
    type: "message",
    event_id: `event-${sequence}`,
    sequence,
    occurred_at: 1,
    turn_id: turn,
    message_key: key,
    sender,
    content,
  };
}
const ledger: Event[] = [
  message(1, "first", "user", "Earlier context"),
  message(2, "first", "agent", "Earlier answer"),
  message(3, "selected", "user", "Remove EURC on Arc"),
  message(4, "selected", "agent", "Original answer"),
  {
    type: "tool_complete",
    event_id: "tool-5",
    sequence: 5,
    occurred_at: 1,
    turn_id: "selected",
    id: "tool",
    tool_name: "evm_commit_txs",
    result: { receipt: "recorded" },
  },
  message(6, "later", "user", "Later request"),
  message(7, "later", "agent", "Later answer"),
];
const branch: Event = {
  type: "branch",
  event_id: "branch-8",
  sequence: 8,
  occurred_at: 1,
  turn_id: "edited",
  kind: "edit",
  target_message_key: "selected:user",
  user_message_key: "selected:user",
  content: "Remove EURC on Base",
  removed_message_keys: ["selected:agent", "later:user", "later:agent"],
  removed_turn_ids: ["selected", "later"],
};

describe("durable conversation branches", () => {
  it("edits the selected request in place, removes later traces, and survives replay", () => {
    const events = [
      ...ledger,
      branch,
      message(9, "edited", "agent", "Edited answer"),
      message(10, "later", "agent", "Late stale answer"),
    ];
    const active = conversationMessages(events);
    expect(active.map((event) => event.content)).toEqual([
      "Earlier context",
      "Earlier answer",
      "Remove EURC on Base",
      "Edited answer",
    ]);
    expect(active[2]).toMatchObject({
      message_key: "selected:user",
      turn_id: "edited",
    });
    expect(
      projectConversationEvents(events).some(
        (event) => event.type === "tool_complete",
      ),
    ).toBe(false);
    expect(conversationMessages(JSON.parse(JSON.stringify(events)))).toEqual(
      active,
    );
    // The immutable ledger retains recorded outcomes even when not in active context.
    expect(events[4]).toMatchObject({ result: { receipt: "recorded" } });
    expect(ledger[2]).toMatchObject({ content: "Remove EURC on Arc" });
  });

  it("reruns the edited branch without adding another user request", () => {
    const events: Event[] = [
      ...ledger,
      branch,
      message(9, "edited", "agent", "Edited answer"),
      {
        ...branch,
        event_id: "branch-10",
        sequence: 10,
        turn_id: "rerun",
        kind: "regenerate",
        target_message_key: "edited:agent",
        removed_turn_ids: ["edited"],
        removed_message_keys: ["edited:agent"],
      },
      message(11, "rerun", "agent", "Regenerated answer"),
    ];
    const active = conversationMessages(events);
    expect(active.filter((event) => event.sender === "user")).toHaveLength(2);
    expect(active.at(-2)).toMatchObject({
      message_key: "selected:user",
      content: "Remove EURC on Base",
      turn_id: "rerun",
    });
    expect(active.at(-1)?.content).toBe("Regenerated answer");
  });

  it("keeps interruption terminal despite a late processing state or live chunk", () => {
    const events: Event[] = [
      message(1, "run", "user", "Question"),
      {
        type: "turn_state_changed",
        event_id: "state-2",
        sequence: 2,
        occurred_at: 1,
        turn_id: "run",
        state: "interrupted",
      },
      {
        type: "turn_state_changed",
        event_id: "state-3",
        sequence: 3,
        occurred_at: 1,
        turn_id: "run",
        state: "processing",
      },
      { ...message(4, "run", "agent", "Stale chunk"), is_streaming: true },
      message(5, "new", "user", "Next question"),
    ];
    expect(
      projectConversationEvents(events).map((event) => event.event_id),
    ).toEqual(["event-1", "state-2", "event-5"]);
  });
});
