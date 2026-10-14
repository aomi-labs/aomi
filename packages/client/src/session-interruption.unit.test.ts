import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient, Session, type Event, type EventPage } from "./";

function page(events: Event[] = []): EventPage {
  return {
    session_id: "stop-session",
    cursor: `cursor-${events.at(-1)?.sequence ?? 0}`,
    events,
    has_more: false,
  };
}

function state(
  sequence: number,
  value: "processing" | "complete" | "interrupted",
  turnId = "turn-1",
): Event {
  return {
    type: "turn_state_changed",
    event_id: `event-${sequence}`,
    sequence,
    occurred_at: sequence,
    turn_id: turnId,
    state: value,
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
  const streams: Array<{
    signal?: AbortSignal;
    frame: Parameters<typeof client.agent.stream>[2];
  }> = [];
  vi.spyOn(client.agent, "stream").mockImplementation(
    async (_sessionId, options, frame) => {
      streams.push({ signal: options.signal, frame });
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    },
  );
  const start = vi
    .spyOn(client.agent, "start")
    .mockResolvedValue(page([state(1, "processing")]));
  const interrupt = vi.spyOn(client.agent, "interrupt");
  const poll = vi.spyOn(client.agent, "poll");
  const session = new Session(client, { sessionId: "stop-session" });
  return { session, start, interrupt, poll, streams };
}

afterEach(() => vi.useRealTimers());

describe("ClientSession responsive Stop", () => {
  it("publishes pending Stop synchronously, dedupes clicks, and freezes partial text after ACK", async () => {
    vi.useFakeTimers();
    const { session, interrupt, streams, poll } = setup();
    await session.sendAsync("Explain safely");
    await vi.advanceTimersByTimeAsync(0);
    const stream = streams[0]!;
    stream.frame("message", {
      turn_id: "turn-1",
      revision: 1,
      message: {
        sender: "agent",
        message_key: "partial",
        content: "Partial answer",
      },
    });
    const ack = deferred<EventPage>();
    interrupt.mockReturnValue(ack.promise);
    const first = session.interrupt();
    const second = session.interrupt();
    expect(first).toBe(second);
    expect(session.getSnapshot()).toMatchObject({
      isStopping: true,
      isStreaming: true,
    });
    await Promise.resolve();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(stream.signal?.aborted).toBe(false);
    ack.resolve(page([state(2, "interrupted")]));
    await first;
    expect(stream.signal?.aborted).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      isStreaming: false,
      turnState: "interrupted",
    });
    expect(session.getSnapshot().liveMessages).toEqual([
      expect.objectContaining({
        content: "Partial answer",
        is_streaming: false,
      }),
    ]);
    stream.frame("message", {
      turn_id: "turn-1",
      revision: 2,
      message: {
        sender: "agent",
        message_key: "partial",
        content: "Late text",
      },
    });
    poll.mockResolvedValue(page([state(3, "processing")]));
    await session.sync();
    expect(session.getSnapshot().turnState).toBe("interrupted");
    expect(session.getSnapshot().events).toContainEqual(state(3, "processing"));
    expect(session.getSnapshot().liveMessages?.[0]?.content).toBe(
      "Partial answer",
    );
    await session.interrupt();
    expect(interrupt).toHaveBeenCalledOnce();
    session.close();
  });

  it("keeps streaming after a failed Stop and allows a fresh retry", async () => {
    const { session, interrupt } = setup();
    await session.sendAsync("Explain safely");
    interrupt.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(session.interrupt()).rejects.toThrow("Network unavailable");
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      isStreaming: true,
      turnState: "processing",
      error: expect.any(Error),
    });
    interrupt.mockResolvedValueOnce(page([state(2, "interrupted")]));
    await session.interrupt();
    expect(interrupt).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      isStreaming: false,
      turnState: "interrupted",
    });
    session.close();
  });

  it("waits for a pending start and interrupts its new turn, never the previous turn", async () => {
    const { session, start, interrupt, poll } = setup();
    poll.mockResolvedValue(page([state(1, "complete", "old-turn")]));
    await session.fetchCurrentState();
    const started = deferred<EventPage>();
    start.mockReturnValue(started.promise);
    const sent = session.sendAsync("New request");
    const duplicate = session.sendAsync("New request");
    const stopped = session.interrupt();
    expect(session.getSnapshot().isStopping).toBe(true);
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
    expect(interrupt).not.toHaveBeenCalled();
    interrupt.mockResolvedValue(page([state(3, "interrupted", "new-turn")]));
    started.resolve(page([state(2, "processing", "new-turn")]));
    await Promise.all([sent, duplicate, stopped]);
    expect(interrupt).toHaveBeenCalledWith("stop-session", "new-turn");
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      turnState: "interrupted",
    });
    expect(session.getSnapshot().pendingUserMessage).toBeUndefined();
    session.close();
  });

  it("clears the prior stopped scope while the next start awaits acknowledgment", async () => {
    const { session, start, interrupt } = setup();
    await session.sendAsync("First request");
    interrupt.mockResolvedValueOnce(page([state(2, "interrupted")]));
    await session.interrupt();
    expect(session.getSnapshot().stoppedTurnId).toBe("turn-1");
    const next = deferred<EventPage>();
    start.mockReturnValueOnce(next.promise);
    const sent = session.sendAsync("Next request");
    await Promise.resolve();
    expect(session.getSnapshot().isSubmitting).toBe(true);
    expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
    const stopped = session.interrupt();
    interrupt.mockResolvedValueOnce(page([state(4, "interrupted", "turn-2")]));
    next.resolve(page([state(3, "processing", "turn-2")]));
    await Promise.all([sent, stopped]);
    expect(interrupt).toHaveBeenLastCalledWith("stop-session", "turn-2");
    expect(session.getSnapshot()).toMatchObject({
      stoppedTurnId: "turn-2",
      isSubmitting: false,
      isStopping: false,
    });
    session.close();
  });

  it("rejects a busy new submission and resolves the waiting send after acknowledged Stop", async () => {
    const { session, interrupt, start } = setup();
    const sent = session.send("Original request");
    const duplicate = session.send("Original request");
    await vi.waitFor(() =>
      expect(session.getSnapshot().turnState).toBe("processing"),
    );
    await expect(session.sendAsync("Another request")).rejects.toThrow(
      "current generation",
    );
    expect(start).toHaveBeenCalledOnce();
    interrupt.mockResolvedValue(page([state(2, "interrupted")]));
    await session.interrupt();
    await expect(Promise.all([sent, duplicate])).resolves.toEqual([
      { messages: [], title: undefined },
      { messages: [], title: undefined },
    ]);
    session.close();
  });

  it("accepts a scoped Stop ACK without skipping a paginated history cursor", async () => {
    const { session, interrupt, poll } = setup();
    await session.sendAsync("Original request");
    interrupt.mockResolvedValue({
      ...page(),
      cursor: "cursor-1",
      stopped_turn_id: "turn-1",
    });
    await session.interrupt();
    expect(session.getSnapshot()).toMatchObject({
      turnId: "turn-1",
      turnState: "interrupted",
      stoppedTurnId: "turn-1",
      isStopping: false,
      isStreaming: false,
      cursor: "cursor-1",
    });
    expect(session.getSnapshot().events).toEqual([state(1, "processing")]);
    poll.mockResolvedValue(page([state(2, "processing")]));
    await session.sync();
    expect(session.getSnapshot()).toMatchObject({
      turnState: "interrupted",
      cursor: "cursor-2",
    });
    session.close();
  });

  it("requires a terminal ACK and leaves Stop retryable if the response omits it", async () => {
    const { session, interrupt } = setup();
    await session.sendAsync("Original request");
    interrupt.mockResolvedValue(page());
    await expect(session.interrupt()).rejects.toThrow("not confirmed");
    expect(session.getSnapshot()).toMatchObject({
      isStopping: false,
      isStreaming: true,
      turnState: "processing",
    });
    session.close();
  });
});
