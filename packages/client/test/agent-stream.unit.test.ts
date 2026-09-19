import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient, Session } from "../src";

const processing = {
  type: "turn_state_changed",
  state: "processing",
  event_id: "evt1",
  sequence: 1,
  turn_id: "turn-1",
  occurred_at: 1,
};
const page = (events: unknown[], cursor = "cursor-1") => ({
  session_id: "session-1",
  events,
  cursor,
  has_more: false,
});
const live = (content: string, revision = 10) => ({
  type: "message",
  turn_id: "turn-1",
  revision,
  message: {
    message_key: "answer",
    sender: "agent",
    content,
    is_streaming: true,
  },
});
const frame = (event: string, value: unknown) =>
  new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
  );

afterEach(() => vi.useRealTimers());

describe("Agent live delivery", () => {
  it("decodes split UTF-8 and CRLF frames without waiting for EOF, and cancels the reader", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            controller = c;
          },
          cancel,
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const agent = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).agent;
    const abort = new AbortController();
    const received: unknown[] = [];
    const reading = agent.stream(
      "session-1",
      { signal: abort.signal, cursor: "cursor-1" },
      (event, data) => {
        received.push([event, data]);
        abort.abort();
      },
    );
    const bytes = new TextEncoder().encode(
      ': keepalive\r\n\r\nevent: message\r\ndata: {"content":"你好"}\r\n\r\n',
    );
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    await reading;
    expect(received).toEqual([["message", { content: "你好" }]]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal).toBe(abort.signal);
  });

  it("shows live text without advancing the cursor, then reconciles a late final message exactly once", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") return Response.json(page([processing]));
      return new Response(
        new ReadableStream({
          start(c) {
            controller = c;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const session = new Session(
      new AomiClient({
        baseUrl: "https://portal.example",
        fetch,
        guest: false,
      }),
      { sessionId: "session-1" },
    );
    await session.sendAsync("hello");
    await vi.advanceTimersByTimeAsync(0);
    controller.enqueue(frame("message", live("Hello")));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().liveMessages?.[0].content).toBe("Hello");
    expect(session.getSnapshot().cursor).toBe("cursor-1");
    expect(session.getSnapshot().events).toHaveLength(1);
    controller.enqueue(frame("message", live("older", 9)));
    controller.enqueue(
      frame("message", { ...live("wrong turn", 11), turn_id: "turn-old" }),
    );
    controller.enqueue(
      frame(
        "page",
        page(
          [{ ...processing, state: "complete", sequence: 2, event_id: "evt2" }],
          "cursor-2",
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().liveMessages?.[0].content).toBe("Hello");
    expect(session.getSnapshot().isStreaming).toBe(true);
    controller.enqueue(
      frame(
        "page",
        page(
          [
            {
              type: "message",
              sender: "agent",
              content: "Hello, complete",
              message_key: "answer",
              turn_id: "turn-1",
              is_streaming: false,
              event_id: "evt3",
              sequence: 3,
              occurred_at: 3,
            },
          ],
          "cursor-3",
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().liveMessages).toEqual([]);
    expect(session.getSnapshot().messages).toHaveLength(1);
    expect(session.getSnapshot().messages[0].content).toBe("Hello, complete");
    expect(session.getSnapshot().isStreaming).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2); // POST + stream, no recurring JSON polls.
    session.close();
  });

  it("retains received prose across reconnects without resubmitting a turn", async () => {
    vi.useFakeTimers();
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetch = vi.fn(async (_url: string, options: RequestInit) =>
      options.method === "POST"
        ? Response.json(page([processing]))
        : new Response(
            new ReadableStream({
              start(c) {
                controllers.push(c);
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
    );
    const session = new Session(
      new AomiClient({
        baseUrl: "https://portal.example",
        fetch,
        guest: false,
      }),
      { sessionId: "session-1" },
    );
    await session.sendAsync("hello");
    await vi.advanceTimersByTimeAsync(0);
    controllers[0].enqueue(frame("message", live("Partial")));
    controllers[0].close();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getSnapshot().liveMessages?.[0].content).toBe("Partial");
    expect(controllers).toHaveLength(2);
    controllers[1].enqueue(frame("message", live("Par", 9)));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().liveMessages?.[0].content).toBe("Partial");
    expect(
      fetch.mock.calls.filter(([, options]) => options.method === "POST"),
    ).toHaveLength(1);
    expect(String(fetch.mock.calls.at(-1)?.[0])).toContain("cursor=cursor-1");
    session.close();
  });
  it.each([401, 403, 404, 405, 501])(
    "fails a non-retryable stream error (%s) without a polling fallback",
    async (status) => {
      vi.useFakeTimers();
      const fetch = vi.fn(async (_url: string, options: RequestInit) =>
        options.method === "POST"
          ? Response.json(page([processing]))
          : Response.json(
              {
                error: {
                  code: "stream_unavailable",
                  message: "Unavailable",
                  retryable: false,
                },
              },
              { status },
            ),
      );
      const session = new Session(
        new AomiClient({
          baseUrl: "https://portal.example",
          fetch,
          guest: false,
        }),
        { sessionId: "session-1" },
      );
      const result = session.send("hello");
      const rejected = expect(result).rejects.toMatchObject({ status });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[1][0])).toContain("/stream");
      expect(session.getSnapshot().isStreaming).toBe(false);
      session.close();
    },
  );
});
