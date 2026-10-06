import { describe, expect, it } from "vitest";
import type { Event } from "@aomi-labs/client";
import { projectRuntimeMessages } from "./message-projection";
import {
  callbackEvents,
  callbackRoot,
  callbackTurn,
} from "../../../../tests/fixtures/commit-callback-events";

function meta(sequence: number, turnId = "turn-1") {
  return {
    event_id: `event-${sequence}`,
    sequence,
    turn_id: turnId,
    occurred_at: sequence,
  };
}
const pendingEvents: Event[] = [
  {
    ...meta(1),
    type: "message",
    sender: "user",
    content: "Explain",
    message_key: "request-1",
  },
  { ...meta(2), type: "turn_state_changed", state: "processing" },
  {
    ...meta(3),
    type: "message",
    sender: "agent",
    content: "Durable answer",
    message_key: "turn-1:response",
    is_streaming: false,
  },
];

describe("terminal Stop ACK projection", () => {
  it.each(["complete", "failed"] as const)(
    "never replaces visible %s with a legacy interrupted projection",
    (state) => {
      const events: Event[] = [
        ...pendingEvents,
        { ...meta(4), type: "turn_state_changed", state },
      ];
      const original = JSON.stringify(events);
      const projected = projectRuntimeMessages(events, undefined, [], "turn-1");
      const assistant = projected.find(
        (message) => message.id === "turn:turn-1",
      )!;
      expect(assistant.metadata?.custom).toMatchObject({
        aomiTurnState: state,
      });
      if (state === "complete")
        expect(assistant.metadata?.custom).toMatchObject({
          aomiResponseMessageKey: "turn-1:response",
        });
      else
        expect(assistant.metadata?.custom).not.toHaveProperty(
          "aomiResponseMessageKey",
        );
      expect(JSON.stringify(events)).toBe(original);
    },
  );

  it("preserves a completed ACK and exact Rerun key after a newer run starts", () => {
    const events: Event[] = [
      ...pendingEvents,
      {
        ...meta(4, "turn-2"),
        type: "message",
        sender: "user",
        content: "New question",
        message_key: "request-2",
      },
      { ...meta(5, "turn-2"), type: "turn_state_changed", state: "processing" },
      {
        ...meta(6, "turn-2"),
        type: "message",
        sender: "agent",
        content: "New provisional text",
        message_key: "turn-2:response",
        is_streaming: true,
      },
    ];
    const projected = projectRuntimeMessages(events, undefined, [], undefined, [
      { turnId: "turn-1", state: "complete" },
    ]);
    expect(
      projected.find((message) => message.id === "turn:turn-1")?.metadata
        ?.custom,
    ).toMatchObject({
      aomiTurnState: "complete",
      aomiResponseMessageKey: "turn-1:response",
    });
    expect(
      projected.find((message) => message.id === "turn:turn-2")?.metadata
        ?.custom,
    ).toMatchObject({ aomiTurnState: "processing" });
    expect(
      events.findLast(
        (event) =>
          event.type === "turn_state_changed" && event.turn_id === "turn-1",
      ),
    ).toMatchObject({ state: "processing" });
  });

  it("does not resurrect a superseded branch from a retained terminal ACK", () => {
    const events: Event[] = [
      ...pendingEvents,
      {
        ...meta(4, "replacement"),
        type: "branch",
        kind: "edit",
        target_message_key: "request-1",
        user_message_key: "request-1",
        content: "Revised request",
        removed_message_keys: ["turn-1:response"],
        removed_turn_ids: ["turn-1"],
      },
      {
        ...meta(5, "replacement"),
        type: "turn_state_changed",
        state: "processing",
      },
      {
        ...meta(6, "replacement"),
        type: "message",
        sender: "agent",
        content: "New provisional text",
        message_key: "replacement:response",
        is_streaming: true,
      },
    ];
    const projected = projectRuntimeMessages(events, undefined, [], undefined, [
      { turnId: "turn-1", state: "complete" },
    ]);
    expect(projected.some((message) => message.id === "turn:turn-1")).toBe(
      false,
    );
    expect(
      projected.find((message) => message.role === "user")?.content,
    ).toEqual([{ type: "text", text: "Revised request" }]);
    const current = projected.find(
      (message) => message.id === "turn:replacement",
    )!;
    expect(current.metadata?.custom).toMatchObject({
      aomiTurnState: "processing",
    });
    expect(current.metadata?.custom).not.toHaveProperty(
      "aomiResponseMessageKey",
    );
  });

  it("retains the Rerun key when the final message follows the durable terminal event", () => {
    const events: Event[] = [
      ...pendingEvents.slice(0, 2),
      { ...meta(3), type: "turn_state_changed", state: "complete" },
      { ...pendingEvents[2]!, ...meta(4) },
    ];
    const assistant = projectRuntimeMessages(events).find(
      (message) => message.id === "turn:turn-1",
    )!;
    expect(assistant.metadata?.custom).toMatchObject({
      aomiTurnState: "complete",
      aomiResponseMessageKey: "turn-1:response",
    });
  });

  it("projects a callback terminal ACK into its owning wallet trace metadata", () => {
    const events = callbackEvents.filter((event) => event.sequence < 32);
    const parent = projectRuntimeMessages(events, undefined, [], undefined, [
      { turnId: callbackTurn, state: "complete" },
    ]).find((message) => message.id === `turn:${callbackRoot}`)!;
    expect(parent.metadata?.custom).toMatchObject({
      aomiContinuationTurnStates: { [callbackTurn]: "complete" },
    });
    expect(
      events.some(
        (event) =>
          event.type === "turn_state_changed" &&
          event.turn_id === callbackTurn &&
          event.state === "complete",
      ),
    ).toBe(false);
  });
});
