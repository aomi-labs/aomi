import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentApiError,
  AomiClient,
  Session,
  type Event,
  type EventPage,
} from "../src";

const sessionId = "terminal-race-session";
function page(events: Event[] = [], extra: Partial<EventPage> = {}): EventPage {
  return {
    session_id: sessionId,
    cursor: `cursor-${events.at(-1)?.sequence ?? 2}`,
    events,
    has_more: false,
    ...extra,
  };
}
function meta(sequence: number, turnId = "turn-1") {
  return {
    event_id: `event-${sequence}`,
    sequence,
    turn_id: turnId,
    occurred_at: sequence,
  };
}
function state(
  sequence: number,
  value: "processing" | "complete" | "failed" | "interrupted",
  turnId = "turn-1",
): Event {
  return {
    ...meta(sequence, turnId),
    type: "turn_state_changed",
    state: value,
  };
}
function answer(sequence: number, turnId = "turn-1"): Event {
  return {
    ...meta(sequence, turnId),
    type: "message",
    sender: "agent",
    content: "Durable final answer",
    message_key: `${turnId}:response`,
    is_streaming: false,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function setup() {
  const client = new AomiClient({
    baseUrl: "https://controlled-upstream.example",
    fetch: vi.fn(),
  });
  const streams: Array<Parameters<typeof client.agent.stream>[2]> = [];
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
  const start = vi.spyOn(client.agent, "start").mockResolvedValue(
    page(
      [
        {
          ...meta(1),
          type: "message",
          sender: "user",
          message_key: "request-1",
          content: "Explain",
        },
        state(2, "processing"),
      ],
      { started_turn_id: "turn-1" },
    ),
  );
  const interrupt = vi.spyOn(client.agent, "interrupt");
  const session = new Session(client, { sessionId });
  return { session, client, start, interrupt, streams };
}
afterEach(() => vi.useRealTimers());

describe("ClientSession Stop terminal races", () => {
  it("preserves completion when the stream finishes before the Stop response", async () => {
    vi.useFakeTimers();
    const { session, interrupt, streams } = setup();
    const sent = session.send("Explain");
    await vi.advanceTimersByTimeAsync(0);
    const ack = deferred<EventPage>();
    interrupt.mockReturnValue(ack.promise);
    const stopped = session.interrupt();
    expect(session.interrupt()).toBe(stopped);
    await Promise.resolve();
    streams[0]!("page", page([answer(3), state(4, "complete")]));
    await expect(sent).resolves.toMatchObject({
      messages: expect.arrayContaining([answer(3)]),
    });
    ack.resolve(
      page([], {
        cursor: "cursor-4",
        terminal_turn: { turn_id: "turn-1", state: "complete" },
      }),
    );
    await stopped;
    expect(interrupt).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({
      turnState: "complete",
      isStopping: false,
      isStreaming: false,
    });
    expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
    expect(session.getSnapshot().terminalTurns).toEqual([
      { turnId: "turn-1", state: "complete" },
    ]);
    expect(session.getSnapshot().messages).toContainEqual(answer(3));
    session.close();
  });

  it.each(["complete", "failed"] as const)(
    "preserves %s events instead of treating a legacy stopped-only response as interruption",
    async (outcome) => {
      const { session, interrupt } = setup();
      await session.sendAsync("Explain");
      interrupt.mockResolvedValue(
        page([answer(3), state(4, outcome)], { stopped_turn_id: "turn-1" }),
      );
      await session.interrupt();
      expect(session.getSnapshot()).toMatchObject({
        turnState: outcome,
        isStopping: false,
        isStreaming: false,
      });
      expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
      expect(session.getSnapshot().terminalTurns).toEqual([
        { turnId: "turn-1", state: outcome },
      ]);
      session.close();
    },
  );

  it.each(["complete", "failed"] as const)(
    "drains the final answer after a bounded %s ACK and retains the old scope during a newer run",
    async (outcome) => {
      vi.useFakeTimers();
      const { session, start, interrupt, streams } = setup();
      const sent = session.send("Explain");
      let settled = false;
      void sent.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      streams[0]!("message", {
        turn_id: "turn-1",
        revision: 1,
        message: {
          sender: "agent",
          message_key: "turn-1:response",
          content: "Provisional text",
        },
      });
      interrupt.mockResolvedValue(
        page([], { terminal_turn: { turn_id: "turn-1", state: outcome } }),
      );
      await session.interrupt();
      expect(settled).toBe(false);
      expect(session.getSnapshot()).toMatchObject({
        turnState: outcome,
        isStopping: false,
        isStreaming: true,
        cursor: "cursor-2",
      });
      expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
      expect(session.getSnapshot().liveMessages?.[0]?.is_streaming).toBe(true);
      expect(session.getSnapshot().events.at(-1)).toEqual(
        state(2, "processing"),
      );
      streams[0]!("page", page([answer(3)]));
      await expect(sent).resolves.toMatchObject({
        messages: expect.arrayContaining([answer(3)]),
      });
      expect(session.getSnapshot().isStreaming).toBe(false);
      start.mockResolvedValueOnce(
        page(
          [
            {
              ...meta(4, "turn-2"),
              type: "message",
              sender: "user",
              message_key: "request-2",
              content: "New question",
            },
            state(5, "processing", "turn-2"),
          ],
          { started_turn_id: "turn-2" },
        ),
      );
      await session.sendAsync("New question");
      expect(session.getSnapshot()).toMatchObject({
        turnId: "turn-2",
        turnState: "processing",
        isStreaming: true,
      });
      expect(session.getSnapshot().terminalTurns).toEqual([
        { turnId: "turn-1", state: outcome },
      ]);
      expect(session.getSnapshot().messages).toContainEqual(answer(3));
      session.close();
    },
  );

  it("rolls back a malformed page after a scoped terminal ACK", async () => {
    const { session, interrupt } = setup();
    await session.sendAsync("Explain");
    interrupt.mockResolvedValue(
      page([{ ...answer(1), event_id: "out-of-order-answer" }], {
        terminal_turn: { turn_id: "turn-1", state: "complete" },
      }),
    );
    await expect(session.interrupt()).rejects.toThrow(
      "not monotonically ordered",
    );
    expect(session.getSnapshot().terminalTurns).toEqual([]);
    expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({
      turnState: "processing",
      isStreaming: true,
      isStopping: false,
    });
    session.close();
  });

  it("rejects a terminal ACK for a different turn without changing the active outcome", async () => {
    const { session, interrupt } = setup();
    await session.sendAsync("Explain");
    interrupt.mockResolvedValue(
      page([], {
        terminal_turn: { turn_id: "different-turn", state: "complete" },
      }),
    );
    await expect(session.interrupt()).rejects.toThrow("turn does not match");
    expect(session.getSnapshot().terminalTurns).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({
      turnState: "processing",
      isStreaming: true,
      isStopping: false,
    });
    session.close();
  });

  it("does not report Stop failure when the pending start is definitively rejected", async () => {
    const { session, start, interrupt } = setup();
    const pending = deferred<EventPage>();
    start.mockReturnValueOnce(pending.promise);
    const sent = session.sendAsync("Explain");
    const rejected = expect(sent).rejects.toThrow("Request rejected");
    const stopped = session.interrupt();
    pending.reject(
      new AgentApiError(422, "invalid_request", "Request rejected", false),
    );
    await rejected;
    await expect(stopped).resolves.toBeUndefined();
    expect(interrupt).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      isSubmitting: false,
      error: expect.any(AgentApiError),
    });
    session.close();
  });

  it.each([
    new TypeError("Network response unavailable"),
    new AgentApiError(
      503,
      "upstream_unavailable",
      "Network response unavailable",
      true,
    ),
    new AgentApiError(
      408,
      "request_timeout",
      "Network response unavailable",
      false,
    ),
  ])(
    "retains the Stop warning for an uncertain pending-start failure: %s",
    async (failure) => {
      const { session, start, interrupt } = setup();
      const pending = deferred<EventPage>();
      start.mockReturnValueOnce(pending.promise);
      const sent = session.sendAsync("Explain");
      const rejected = expect(sent).rejects.toThrow(
        "Network response unavailable",
      );
      const stopped = session.interrupt();
      const warning = expect(stopped).rejects.toThrow(
        "Network response unavailable",
      );
      pending.reject(failure);
      await Promise.all([rejected, warning]);
      expect(interrupt).not.toHaveBeenCalled();
      expect(session.getSnapshot()).toMatchObject({
        isStopping: false,
        isStartUncertain: true,
      });
      session.close();
    },
  );

  it.each([
    new TypeError("Lost start response"),
    new AgentApiError(503, "upstream_unavailable", "Lost start response", true),
    new AgentApiError(408, "request_timeout", "Lost start response", false),
  ])(
    "recovers the exact admitted intent through bounded history after %s",
    async (failure) => {
      const { session, client, start, interrupt } = setup();
      const pending = deferred<EventPage>();
      start.mockReturnValueOnce(pending.promise);
      start.mockResolvedValueOnce(
        page([], { started_turn_id: "owned-turn", has_more: true }),
      );
      const poll = vi
        .spyOn(client.agent, "poll")
        .mockResolvedValueOnce(
          page(
            [answer(1, "previous-turn"), state(2, "complete", "previous-turn")],
            { has_more: true },
          ),
        )
        .mockResolvedValueOnce(page([state(3, "processing", "owned-turn")]));
      interrupt.mockResolvedValue(
        page([], {
          terminal_turn: { turn_id: "owned-turn", state: "interrupted" },
        }),
      );
      const sent = session.sendAsync("Explain");
      const rejected = expect(sent).rejects.toThrow("Lost start response");
      const stopped = session.interrupt();
      expect(session.interrupt()).toBe(stopped);
      await Promise.resolve();
      session.syncRuntimeOptions({
        model: "changed-model",
        clientId: "changed-client",
      });
      pending.reject(failure);
      await rejected;
      await stopped;
      expect(poll).toHaveBeenCalledTimes(2);
      expect(start).toHaveBeenCalledTimes(2);
      const { cursor: _initialCursor, ...initial } = start.mock.calls[0]![0];
      const { cursor: _recoveryCursor, ...recovered } = start.mock.calls[1]![0];
      expect(recovered).toEqual(initial);
      expect(start.mock.calls[1]![1]?.idempotencyKey).toBe(
        start.mock.calls[0]![1]?.idempotencyKey,
      );
      expect(interrupt).toHaveBeenCalledExactlyOnceWith(
        sessionId,
        "owned-turn",
      );
      expect(session.getSnapshot()).toMatchObject({
        isStartUncertain: false,
        isStopping: false,
        stoppedTurnId: "owned-turn",
      });
      session.close();
    },
  );

  it("keeps Stop actionable with no admitted run and recovers after a later retry", async () => {
    const { session, client, start, interrupt } = setup();
    const failure = new TypeError("Lost start response");
    start.mockRejectedValueOnce(failure);
    await expect(session.sendAsync("Explain")).rejects.toBe(failure);
    const poll = vi.spyOn(client.agent, "poll").mockResolvedValueOnce(page([]));
    await expect(session.interrupt()).rejects.toBe(failure);
    expect(start).toHaveBeenCalledOnce();
    expect(interrupt).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      isStartUncertain: true,
      pendingUserMessage: "Explain",
    });
    await expect(session.sendAsync("Different request")).rejects.toThrow(
      "Resolve the pending request",
    );
    poll.mockResolvedValueOnce(page([state(3, "processing", "owned-turn")]));
    start.mockResolvedValueOnce(page([], { started_turn_id: "owned-turn" }));
    interrupt.mockRejectedValueOnce(new Error("Stop transport lost"));
    await expect(session.interrupt()).rejects.toThrow("Stop transport lost");
    expect(session.getSnapshot().isStartUncertain).toBe(true);
    interrupt.mockResolvedValueOnce(
      page([], {
        terminal_turn: { turn_id: "owned-turn", state: "interrupted" },
      }),
    );
    const retried = session.interrupt();
    expect(session.interrupt()).toBe(retried);
    await retried;
    expect(interrupt.mock.calls).toEqual([
      [sessionId, "owned-turn"],
      [sessionId, "owned-turn"],
    ]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().isStartUncertain).toBe(false);
    session.close();
  });

  it("never substitutes an unrelated active turn when exact admission cannot be confirmed", async () => {
    const { session, client, start, interrupt } = setup();
    start.mockRejectedValueOnce(new TypeError("Lost start response"));
    await expect(session.sendAsync("Explain")).rejects.toThrow(
      "Lost start response",
    );
    vi.spyOn(client.agent, "poll").mockResolvedValue(
      page([state(3, "processing", "other-client-turn")]),
    );
    start.mockRejectedValue(
      new AgentApiError(
        409,
        "execution_conflict",
        "Different run active",
        false,
      ),
    );
    await expect(session.interrupt()).rejects.toThrow("Different run active");
    await expect(session.interrupt()).rejects.toThrow("Different run active");
    expect(interrupt).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      turnId: "other-client-turn",
      isStartUncertain: true,
    });
    session.close();
  });

  it("stops only the original replay identity while a newer branch remains active", async () => {
    const { session, client, start, interrupt } = setup();
    start.mockRejectedValueOnce(new TypeError("Lost start response"));
    await expect(
      session.sendAsync("Explain", { edit: "original-user" }),
    ).rejects.toThrow("Lost start response");
    vi.spyOn(client.agent, "poll").mockResolvedValue(
      page([
        state(1, "complete", "owned-turn"),
        {
          ...meta(2, "newer-turn"),
          type: "branch",
          mode: "edit",
          source_message_key: "newer-user",
          message_key: "newer-user",
          content: "Newer request",
          removed_message_keys: [],
          removed_turn_ids: [],
        } as Event,
        state(3, "processing", "newer-turn"),
      ]),
    );
    start.mockResolvedValueOnce(page([], { started_turn_id: "owned-turn" }));
    interrupt.mockResolvedValueOnce(
      page([], { terminal_turn: { turn_id: "owned-turn", state: "complete" } }),
    );
    await session.interrupt();
    expect(interrupt).toHaveBeenCalledExactlyOnceWith(sessionId, "owned-turn");
    expect(session.getSnapshot()).toMatchObject({
      turnId: "newer-turn",
      turnState: "processing",
      isStreaming: true,
      isStartUncertain: false,
    });
    expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
    session.close();
  });

  it.each(["complete", "failed"] as const)(
    "finishes a bounded %s callback when its canonical final response arrives",
    async (outcome) => {
      vi.useFakeTimers();
      const { session, start, interrupt, streams } = setup();
      const callbackTurn = "broadcast-terminal:owned-batch";
      start.mockResolvedValue(
        page(
          [
            {
              ...meta(1, callbackTurn),
              type: "message",
              sender: "user",
              message_key: "request-1",
              content: "Explain",
            },
            state(2, "processing", callbackTurn),
          ],
          { started_turn_id: callbackTurn },
        ),
      );
      const sent = session.send("Explain");
      await vi.advanceTimersByTimeAsync(0);
      interrupt.mockResolvedValue(
        page([], { terminal_turn: { turn_id: callbackTurn, state: outcome } }),
      );
      await session.interrupt();
      expect(session.getSnapshot()).toMatchObject({
        turnId: callbackTurn,
        turnState: outcome,
        isStreaming: true,
      });
      streams[0]!("page", page([answer(3, callbackTurn)]));
      await expect(sent).resolves.toMatchObject({
        messages: expect.arrayContaining([answer(3, callbackTurn)]),
      });
      expect(session.getSnapshot().isStreaming).toBe(false);
      expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
      session.close();
    },
  );

  it("keeps a newer accepted turn active when an older completion ACK arrives late", async () => {
    vi.useFakeTimers();
    const { session, client, interrupt, streams } = setup();
    const sent = session.send("Explain");
    await vi.advanceTimersByTimeAsync(0);
    const ack = deferred<EventPage>();
    interrupt.mockReturnValueOnce(ack.promise);
    const stopped = session.interrupt();
    await Promise.resolve();
    streams[0]!("page", page([answer(3), state(4, "complete")]));
    await sent;
    const newerEvents: Event[] = [
      {
        ...meta(5, "turn-2"),
        type: "message",
        sender: "user",
        message_key: "request-2",
        content: "New accepted question",
      },
      state(6, "processing", "turn-2"),
    ];
    vi.spyOn(client.agent, "poll").mockResolvedValueOnce(page(newerEvents));
    await session.fetchCurrentState();
    expect(session.getSnapshot()).toMatchObject({
      turnId: "turn-2",
      turnState: "processing",
      isStreaming: true,
    });
    // A trailing canonical answer for the completed old run must still land,
    // without taking ownership from the newer accepted run.
    ack.resolve(
      page([state(4, "complete"), answer(7)], {
        terminal_turn: { turn_id: "turn-1", state: "complete" },
      }),
    );
    await stopped;
    expect(session.getSnapshot()).toMatchObject({
      turnId: "turn-2",
      turnState: "processing",
      isStreaming: true,
      isStopping: false,
    });
    expect(session.getSnapshot().terminalTurns).toEqual([
      { turnId: "turn-1", state: "complete" },
    ]);
    expect(session.getSnapshot().messages).toContainEqual(answer(7));
    session.close();
  });
});
