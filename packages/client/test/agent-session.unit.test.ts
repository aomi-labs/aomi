import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentApiError, AomiClient, Session } from "../src";
import type { Action, Event, EventPage } from "../src";

const occurredAt = Date.parse("2026-08-20T00:00:00Z");

function page(
  events: Event[] = [],
  overrides: Partial<EventPage> = {},
): EventPage {
  return {
    session_id: "session-agent",
    cursor: `cursor-${events.at(-1)?.sequence ?? 0}`,
    events,
    has_more: false,
    ...overrides,
  };
}

function meta(type: string, sequence: number) {
  return {
    type,
    event_id: `event-${sequence}`,
    sequence,
    turn_id: "turn-1",
    occurred_at: occurredAt + sequence,
  };
}

function turn(
  sequence: number,
  state: "processing" | "awaiting_action" | "complete",
  turnId = "turn-1",
) {
  return {
    ...meta("turn_state_changed", sequence),
    turn_id: turnId,
    type: "turn_state_changed",
    state,
  } as const;
}

function action(
  request: Action["request"],
  overrides: Partial<Action> = {},
): Action {
  return {
    ...meta("action", 2),
    type: "action",
    id: "action-1",
    revision: 1,
    state: "pending",
    request,
    result: null,
    created_at: occurredAt,
    expires_at: null,
    ...overrides,
  };
}

function client() {
  return new AomiClient({
    baseUrl: "https://portal.example",
    fetch: vi.fn(),
  });
}

describe("ClientSession Agent transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reduces one ordered Event page into messages, title, and lifecycle", async () => {
    const api = client();
    vi.spyOn(api.agent, "start").mockResolvedValue(
      page([
        {
          ...meta("message", 1),
          type: "message",
          message_key: "message-1",
          sender: "agent",
          content: "done",
          is_streaming: false,
        },
        {
          ...meta("title_changed", 2),
          type: "title_changed",
          title: "Agent thread",
        },
        turn(3, "complete"),
      ]),
    );
    const session = new Session(api, {
      sessionId: "session-agent",
      app: "default",
    });
    const snapshots: number[][] = [];
    const unsubscribe = session.subscribe(() => {
      snapshots.push(
        session.getSnapshot().events.map((event) => event.sequence),
      );
    });

    await expect(session.send("hello")).resolves.toEqual({
      messages: [
        expect.objectContaining({
          message_key: "message-1",
          sender: "agent",
          content: "done",
        }),
      ],
      title: "Agent thread",
    });
    expect(api.agent.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-agent",
        message: "hello",
        app: "default",
      }),
      { idempotencyKey: expect.stringMatching(/^idem_[a-f0-9]{32}$/) },
    );
    expect(snapshots.at(-1)).toEqual([1, 2, 3]);
    expect(session.getSnapshot().turnState).toBe("complete");
    unsubscribe();
    session.close();
  });

  it("reuses the start Intent idempotency key after an uncertain response", async () => {
    const api = client();
    const start = vi
      .spyOn(api.agent, "start")
      .mockRejectedValueOnce(
        new AgentApiError(503, "upstream_unavailable", "try again", true),
      )
      .mockResolvedValue(
        page([
          {
            ...meta("message", 1),
            type: "message",
            message_key: "message-1",
            sender: "agent",
            content: "done",
            is_streaming: false,
          },
          turn(2, "complete"),
        ]),
      );
    const session = new Session(api, { sessionId: "session-agent" });

    await expect(session.send("hello")).rejects.toThrow("try again");
    await expect(session.send("hello")).resolves.toBeDefined();

    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]?.[1]?.idempotencyKey).toBe(
      start.mock.calls[1]?.[1]?.idempotencyKey,
    );
    session.close();
  });

  it("drains the final agent message without waiting for another title", async () => {
    vi.useFakeTimers();
    const api = client();
    // Turn 1 completed earlier and set a session title.
    vi.spyOn(api.agent, "start")
      .mockResolvedValueOnce(
        page([
          {
            ...meta("message", 1),
            type: "message",
            message_key: "message-1",
            sender: "agent",
            content: "first answer",
            is_streaming: false,
          },
          {
            ...meta("title_changed", 2),
            type: "title_changed",
            title: "Existing title",
          },
          turn(3, "complete"),
        ]),
      )
      // Turn 2: the start page carries only the new processing state.
      .mockResolvedValueOnce(page([turn(4, "processing", "turn-2")]));
    const session = new Session(api, {
      sessionId: "session-agent",
      pollIntervalMs: 10,
    });
    await session.send("first");

    // Turn 2's ledger trails: complete arrives alone, then the final message.
    // The thread title does not change, so no title event follows this turn.
    vi.spyOn(api.agent, "poll")
      .mockResolvedValueOnce(page([turn(5, "complete", "turn-2")]))
      .mockResolvedValue(
        page([
          {
            ...meta("message", 6),
            turn_id: "turn-2",
            type: "message",
            message_key: "message-final",
            sender: "agent",
            content: "FINAL ANSWER",
            is_streaming: false,
          },
        ]),
      );

    const result = session.send("second");
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);

    expect(settled).toBe(true);
    await expect(result).resolves.toMatchObject({
      title: "Existing title",
    });
    expect(session.getSnapshot().messages.at(-1)).toMatchObject({
      message_key: "message-final",
      content: "FINAL ANSWER",
    });
    expect(session.getSnapshot().isPolling).toBe(false);
    session.close();
  });

  it("preserves cursor order across tool progress and the terminal message", async () => {
    vi.useFakeTimers();
    const api = client();
    vi.spyOn(api.agent, "start").mockResolvedValue(
      page(
        [
          turn(1, "processing"),
          {
            ...meta("tool_update", 2),
            type: "tool_update",
            tool: "web_search",
            message: "Checking ETH price",
          },
        ],
        { cursor: "cursor-2" },
      ),
    );
    const poll = vi.spyOn(api.agent, "poll").mockResolvedValue(
      page(
        [
          {
            ...meta("message", 3),
            type: "message",
            sender: "agent",
            content: "ETH is $2,352.",
            is_streaming: false,
          },
          turn(4, "complete"),
        ],
        { cursor: "cursor-4" },
      ),
    );
    const session = new Session(api, {
      sessionId: "session-agent",
      pollIntervalMs: 10,
    });

    await session.sendAsync("Check ETH price");
    expect(session.getSnapshot().turnState).toBe("processing");
    await vi.advanceTimersByTimeAsync(0);

    expect(poll).toHaveBeenCalledWith("session-agent", {
      cursor: "cursor-2",
      waitMs: 25_000,
    });
    expect(session.getSnapshot().messages).toEqual([
      expect.objectContaining({ content: "ETH is $2,352." }),
    ]);
    expect(session.getSnapshot().turnState).toBe("complete");
    session.close();
  });

  it("recovers an invalid Event cursor with one cursorless fetch", async () => {
    const api = client();
    const poll = vi
      .spyOn(api.agent, "poll")
      .mockRejectedValueOnce(
        new AgentApiError(400, "invalid_cursor", "invalid cursor", false),
      )
      .mockResolvedValueOnce(
        page([turn(1, "complete")], { cursor: "cursor-recovered" }),
      );
    const session = new Session(api, { sessionId: "session-agent" });

    await session.fetchCurrentState();

    expect(poll).toHaveBeenNthCalledWith(1, "session-agent", {
      cursor: undefined,
      waitMs: 0,
    });
    expect(poll).toHaveBeenNthCalledWith(2, "session-agent");
    expect(session.getSnapshot().cursor).toBe("cursor-recovered");
    expect(session.getSnapshot().turnState).toBe("complete");
    session.close();
  });

  it("keeps the complete EVM request in the Action and responds by revision", async () => {
    const api = client();
    const pending = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "1",
          data: "0x1234",
          label: "Transfer",
          kind: "transfer",
        },
      ],
    });
    vi.spyOn(api.agent, "start").mockResolvedValue(
      page([turn(1, "processing"), pending, turn(3, "awaiting_action")]),
    );
    const respond = vi.spyOn(api.agent, "respondToAction").mockResolvedValue(
      action(pending.request, {
        sequence: 4,
        event_id: "event-4",
        revision: 2,
        state: "rejected",
        result: { status: "rejected", reason: "Not now" },
      }),
    );
    vi.spyOn(api.agent, "poll").mockResolvedValue(
      page([turn(5, "complete")], { cursor: "cursor-5" }),
    );
    const session = new Session(api, { sessionId: "session-agent" });

    await session.sendAsync("execute");
    expect(session.actions.pending()).toEqual([pending]);
    await session.actions.reject("action-1", "Not now");

    expect(respond).toHaveBeenCalledWith(
      "session-agent",
      "action-1",
      1,
      {
        status: "rejected",
        reason: "Not now",
      },
      expect.any(String),
    );
    expect(session.actions.pending()).toEqual([]);
    session.close();
  });

  it("keeps polling after an Action response until lifecycle resumes", async () => {
    vi.useFakeTimers();
    const api = client();
    const pending = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "1",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
    });
    vi.spyOn(api.agent, "start").mockResolvedValue(
      page([turn(1, "processing"), pending, turn(3, "awaiting_action")]),
    );
    const rejected = action(pending.request, {
      sequence: 4,
      event_id: "event-4",
      revision: 2,
      state: "rejected",
      result: { status: "rejected", reason: "Not now" },
    });
    vi.spyOn(api.agent, "respondToAction").mockResolvedValue(rejected);
    const poll = vi
      .spyOn(api.agent, "poll")
      .mockResolvedValueOnce(page([rejected], { cursor: "cursor-4" }))
      .mockResolvedValueOnce(
        page([turn(5, "complete")], { cursor: "cursor-5" }),
      )
      .mockResolvedValueOnce(
        page(
          [
            {
              ...meta("message", 6),
              type: "message",
              message_key: "message-final",
              sender: "agent",
              content: "The action was rejected.",
              is_streaming: false,
            },
          ],
          { cursor: "cursor-6" },
        ),
      );
    const session = new Session(api, {
      sessionId: "session-agent",
      pollIntervalMs: 10,
    });

    await session.sendAsync("execute");
    await session.actions.reject("action-1", "Not now");
    await vi.advanceTimersByTimeAsync(0);

    expect(poll).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().turnState).toBe("awaiting_action");
    expect(session.getSnapshot().isPolling).toBe(true);

    await vi.advanceTimersByTimeAsync(10);

    expect(poll).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().turnState).toBe("complete");
    expect(session.getSnapshot().isPolling).toBe(true);

    await vi.advanceTimersByTimeAsync(10);

    expect(poll).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().title).toBeUndefined();
    expect(session.getSnapshot().isPolling).toBe(false);
    session.close();
  });

  it("recovers a signing Action from the Event ledger without snapshot state", async () => {
    const api = client();
    const pending = action({
      type: "sign",
      requestId: "sign-1",
      chainFamily: "evm",
      executionKind: "message",
      signer: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      description: "Sign message",
      payloads: [{ kind: "evm_personal", message: "0x6869" }],
    });
    vi.spyOn(api.agent, "poll").mockResolvedValue(
      page([pending, turn(3, "awaiting_action")], { cursor: "cursor-3" }),
    );
    const session = new Session(api, { sessionId: "session-agent" });

    await session.fetchCurrentState();

    expect(session.actions.pending()).toEqual([pending]);
    expect(session.getSnapshot().turnState).toBe("awaiting_action");
    expect(session.getSnapshot().isPolling).toBe(false);
    session.close();
  });
});
