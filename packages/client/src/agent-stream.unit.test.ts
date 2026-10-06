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
  it.each(["owner-first", "sibling-first"] as const)(
    "reads the exact batch callback beyond the legacy drain window (%s)",
    async (order) => {
      vi.useFakeTimers();
      let delivered = false;
      const callbackTurn = "broadcast-terminal:callback-batch";
      let callbackReader!: ReadableStreamDefaultController<Uint8Array>;
      const view = () => ({
        version: 1,
        commit_id: "callback-commit",
        thread_id: "session-1",
        stage_id: "evm:1",
        chain_family: "evm",
        chain_ref: "8453",
        signer: "wallet",
        broadcaster: "wallet",
        state: "confirmed",
        transaction_id: "hash",
        failure_code: null,
        batch: {
          batch_id: "callback-batch",
          index: 0,
          ordered_stage_ids: ["evm:1", "evm:2"],
          ordered_commit_ids: ["callback-commit", "callback-tail"],
          sources: [],
          predecessor_commit_id: null,
          review_digest: "review",
        },
        review: null,
        wallet_attempt: null,
        action: null,
        continuation: {
          version: 1,
          revision: delivered ? 1 : 0,
          state: delivered ? "completed" : "pending",
          attempts: delivered ? 1 : 0,
        },
      });
      const sibling = () => ({
        ...view(),
        commit_id: "callback-tail",
        stage_id: "evm:2",
        batch: {
          ...view().batch,
          index: 1,
          predecessor_commit_id: "callback-commit",
        },
        continuation: undefined,
      });
      const views = () =>
        order === "owner-first" ? [view(), sibling()] : [sibling(), view()];
      const rootEvents = [
        {
          type: "message",
          sender: "agent",
          content: "Submitted",
          is_streaming: false,
          event_id: "parent-answer",
          sequence: 1,
          turn_id: "turn-1",
          occurred_at: 1,
        },
        {
          ...processing,
          state: "complete",
          event_id: "parent-complete",
          sequence: 2,
        },
      ];
      const callbackEvents = [
        {
          type: "message",
          sender: "agent",
          content: "Confirmed; next pair is prepared.",
          is_streaming: false,
          message_key: `${callbackTurn}:response`,
          event_id: "callback-answer",
          sequence: 3,
          turn_id: callbackTurn,
          occurred_at: 3,
        },
        {
          ...processing,
          state: "complete",
          event_id: "callback-complete",
          sequence: 4,
          turn_id: callbackTurn,
        },
      ];
      const fetch = vi.fn(async (url: string) => {
        if (url.includes("/api/commits/")) return Response.json(view());
        if (url.includes("/stream"))
          return new Response(
            new ReadableStream({
              start(controller) {
                callbackReader = controller;
                controller.enqueue(
                  frame("page", {
                    ...page(callbackEvents.slice(0, 1), "callback-cursor"),
                    commits: views(),
                  }),
                );
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        return Response.json({ ...page(rootEvents), commits: views() });
      });
      const session = new Session(
        new AomiClient({
          baseUrl: "https://portal.example",
          fetch,
          guest: false,
        }),
        { sessionId: "session-1" },
      );
      try {
        await session.fetchCurrentState();
        expect(session.getSnapshot().isStreaming).toBe(false);
        expect(session.getSnapshot().isSubmitting).toBe(false);
        await vi.advanceTimersByTimeAsync(61_000);
        delivered = true;
        await vi.advanceTimersByTimeAsync(1_001);
        expect(
          session
            .getSnapshot()
            .commits.find((commit) => commit.commit_id === "callback-commit")
            ?.continuation?.state,
        ).toBe("completed");
        expect(
          session
            .getSnapshot()
            .messages.some(
              (message) => message.message_key === `${callbackTurn}:response`,
            ),
        ).toBe(true);
        expect(session.getSnapshot().isStreaming).toBe(true);
        callbackReader.enqueue(
          frame("page", page(callbackEvents.slice(1), "completed-cursor")),
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(session.getSnapshot().isStreaming).toBe(false);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(
          fetch.mock.calls.filter(([url]) => url.includes("/stream")),
        ).toHaveLength(1);
      } finally {
        session.close();
      }
    },
  );

  it.each(["hydrated", "retrying", "closed"] as const)(
    "does not reopen event delivery for %s callback metadata",
    async (mode) => {
      vi.useFakeTimers();
      const callbackTurn = "broadcast-terminal:known-commit";
      const view = (state: string, revision: number) => ({
        version: 1,
        commit_id: "known-commit",
        thread_id: "session-1",
        stage_id: "evm:1",
        chain_family: "evm",
        chain_ref: "8453",
        signer: "wallet",
        broadcaster: "wallet",
        state: "confirmed",
        transaction_id: "hash",
        failure_code: null,
        batch: null,
        review: null,
        wallet_attempt: null,
        action: null,
        continuation: { version: 1, revision, state, attempts: 1 },
      });
      const events =
        mode === "hydrated"
          ? [
              {
                type: "message",
                sender: "agent",
                content: "Confirmed",
                is_streaming: false,
                message_key: `${callbackTurn}:response`,
                event_id: "answer",
                sequence: 1,
                turn_id: callbackTurn,
                occurred_at: 1,
              },
              {
                ...processing,
                state: "complete",
                sequence: 2,
                turn_id: callbackTurn,
              },
            ]
          : [{ ...processing, state: "complete", sequence: 2 }];
      const fetch = vi.fn(async (url: string) => {
        if (url.includes("/api/commits/"))
          return Response.json(
            view(mode === "retrying" ? "retrying" : "completed", 1),
          );
        return Response.json({
          ...page(events),
          commits: [view("pending", 0)],
        });
      });
      const session = new Session(
        new AomiClient({
          baseUrl: "https://portal.example",
          fetch,
          guest: false,
        }),
        { sessionId: "session-1" },
      );
      try {
        await session.fetchCurrentState();
        if (mode === "closed") session.close();
        await vi.advanceTimersByTimeAsync(5_001);
        expect(
          fetch.mock.calls.filter(([url]) => url.includes("/stream")),
        ).toHaveLength(0);
        expect(session.getSnapshot().isStreaming).toBe(false);
        if (mode === "closed")
          expect(
            fetch.mock.calls.filter(([url]) => url.includes("/api/commits/")),
          ).toHaveLength(0);
      } finally {
        session.close();
      }
    },
  );

  it("leaves an unrelated active user turn in charge when old callback delivery completes", async () => {
    vi.useFakeTimers();
    let delivered = false;
    let activeReader!: ReadableStreamDefaultController<Uint8Array>;
    let streamCount = 0;
    const callbackTurn = "broadcast-terminal:old-commit";
    const view = () => ({
      version: 1,
      commit_id: "old-commit",
      thread_id: "session-1",
      stage_id: "evm:1",
      chain_family: "evm",
      chain_ref: "8453",
      signer: "wallet",
      broadcaster: "wallet",
      state: "confirmed",
      transaction_id: "hash",
      failure_code: null,
      batch: null,
      review: null,
      wallet_attempt: null,
      action: null,
      continuation: {
        version: 1,
        revision: delivered ? 1 : 0,
        state: delivered ? "completed" : "pending",
        attempts: 1,
      },
    });
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/commits/")) return Response.json(view());
      if (options?.method === "POST")
        return Response.json(
          page([
            {
              ...processing,
              event_id: "new-processing",
              sequence: 3,
              turn_id: "new-user-turn",
            },
          ]),
        );
      if (url.includes("/stream"))
        return new Response(
          new ReadableStream({
            start(controller) {
              if (++streamCount === 1) {
                activeReader = controller;
                return;
              }
              controller.enqueue(
                frame(
                  "page",
                  page([
                    {
                      type: "message",
                      event_id: "old-callback-answer",
                      sequence: 6,
                      turn_id: callbackTurn,
                      occurred_at: 6,
                      sender: "agent",
                      content: "Old callback delivered",
                      message_key: `${callbackTurn}:response`,
                      is_streaming: false,
                    },
                    {
                      ...processing,
                      event_id: "old-callback-complete",
                      sequence: 7,
                      turn_id: callbackTurn,
                      state: "complete",
                    },
                  ]),
                ),
              );
              controller.close();
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      return Response.json({
        ...page([{ ...processing, state: "complete", sequence: 2 }]),
        commits: [view()],
      });
    });
    const session = new Session(
      new AomiClient({
        baseUrl: "https://portal.example",
        fetch,
        guest: false,
      }),
      { sessionId: "session-1" },
    );
    try {
      await session.fetchCurrentState();
      await session.sendAsync("new independent request");
      await vi.advanceTimersByTimeAsync(1);
      delivered = true;
      await vi.advanceTimersByTimeAsync(1_001);
      expect(session.getSnapshot().commits[0].continuation?.state).toBe(
        "completed",
      );
      expect(session.getSnapshot().isStreaming).toBe(true);
      expect(session.getSnapshot().pendingUserMessage).toBe(
        "new independent request",
      );
      expect(
        fetch.mock.calls.filter(([url]) => url.includes("/stream")),
      ).toHaveLength(1);
      activeReader.enqueue(
        frame(
          "page",
          page([
            {
              type: "message",
              event_id: "new-answer",
              sequence: 4,
              turn_id: "new-user-turn",
              occurred_at: 4,
              sender: "agent",
              content: "Independent request complete",
              is_streaming: false,
            },
            {
              ...processing,
              event_id: "new-complete",
              sequence: 5,
              turn_id: "new-user-turn",
              state: "complete",
            },
          ]),
        ),
      );
      await vi.advanceTimersByTimeAsync(1);
      expect(
        session
          .getSnapshot()
          .messages.filter(
            (message) => message.message_key === `${callbackTurn}:response`,
          ),
      ).toHaveLength(1);
      expect(session.getSnapshot().isStreaming).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(
        fetch.mock.calls.filter(([url]) => url.includes("/stream")),
      ).toHaveLength(2);
    } finally {
      session.close();
    }
  });

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

  it("drops an expired stream cursor before reconnecting for durable replay", async () => {
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
    expect(String(fetch.mock.calls[1][0])).toContain("cursor=cursor-1");
    controllers[0].enqueue(frame("resync", {}));
    await vi.advanceTimersByTimeAsync(1);
    expect(controllers).toHaveLength(2);
    expect(String(fetch.mock.calls[2][0])).not.toContain("cursor=");
    controllers[1].enqueue(frame("page", page([processing], "cursor-2")));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().cursor).toBe("cursor-2");
    expect(session.getSnapshot().events).toHaveLength(1);
    session.close();
  });

  it.each(["live-first", "final-first"])(
    "retires only the promoted callback draft when %s frames arrive",
    async (order) => {
      vi.useFakeTimers();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const turn = "broadcast-terminal:batch-1";
      const fetch = vi.fn(async (_url: string, options: RequestInit) =>
        options.method === "POST"
          ? Response.json(page([{ ...processing, turn_id: turn }]))
          : new Response(
              new ReadableStream({
                start(c) {
                  controller = c;
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
      await session.sendAsync("continue");
      await vi.advanceTimersByTimeAsync(0);
      const temporary = {
        type: "message",
        turn_id: turn,
        revision: 10,
        message: {
          message_key: `${turn}:trace:temporary`,
          sender: "agent",
          content: "Final answer draft",
          is_streaming: true,
        },
      };
      const final = {
        type: "message",
        sender: "agent",
        content: "Final answer",
        message_key: `${turn}:response`,
        turn_id: turn,
        is_streaming: false,
        event_id: "final-1",
        sequence: 2,
        occurred_at: 2,
      };
      const commentary = {
        ...final,
        message_key: `${turn}:draft:commentary`,
        content: "Checking the next step",
        event_id: "commentary-1",
        sequence: 3,
      };
      const equalText = {
        ...final,
        message_key: `${turn}:draft:separate-note`,
        event_id: "separate-note-1",
        sequence: 4,
      };
      if (order === "live-first")
        controller.enqueue(frame("message", temporary));
      controller.enqueue(
        frame("page", page([final, commentary, equalText], "cursor-2")),
      );
      if (order === "final-first")
        controller.enqueue(frame("message", temporary));
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getSnapshot().liveMessages).toEqual([]);
      expect(
        session.getSnapshot().messages.map((message) => message.content),
      ).toEqual(["Final answer", "Checking the next step", "Final answer"]);
      session.close();
    },
  );

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
