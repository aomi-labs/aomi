import { describe, expect, it, vi } from "vitest";

import { AgentApiError, AomiClient } from "./";

describe("AgentTransport", () => {
  it("uses canonical routes, cursor long poll, and mutation keys", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      Response.json({
        session_id: "session-1",
        cursor: "cursor-1",
        events: [],
        has_more: false,
      }),
    );
    const agent = new AomiClient({
      baseUrl: "https://portal.example/",
      fetch,
      guest: false,
    }).agent;

    await agent.start(
      { sessionId: "session-1", message: "hello", app: "default" },
      {
        idempotencyKey: "idem-fixed",
        paymentSignature: "payment",
      },
    );
    await agent.poll("session-1", { cursor: "cursor-1", waitMs: 40_000 });

    expect(fetch.mock.calls[0][0]).toBe("https://portal.example/v1/agent/chat");
    const startHeaders = new Headers(fetch.mock.calls[0][1].headers);
    expect(startHeaders.get("idempotency-key")).toBe("idem-fixed");
    expect(startHeaders.get("payment-signature")).toBe("payment");
    expect(startHeaders.has("x-aomi-inference-funding")).toBe(false);
    expect(startHeaders.get("x-session-id")).toBe("session-1");
    expect(startHeaders.get("x-thread-id")).toBe("session-1");
    expect(fetch.mock.calls[1][0]).toBe(
      "https://portal.example/v1/agent/chat/session-1?cursor=cursor-1&wait=30000",
    );
    const pollHeaders = new Headers(fetch.mock.calls[1][1].headers);
    expect(pollHeaders.get("x-session-id")).toBe("session-1");
    expect(pollHeaders.get("x-thread-id")).toBe("session-1");
  });


  it("parses stable public errors and retry classification", async () => {
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch: vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "busy",
              message: "Turn is active",
            },
          },
          { status: 409, headers: { "x-request-id": "request-1" } },
        ),
      ),
      guest: false,
    });
    const error = await client.agent.poll("session-1").catch((value) => value);
    expect(error).toBeInstanceOf(AgentApiError);
    expect(error).toMatchObject({
      code: "busy",
      requestId: "request-1",
      retryable: false,
    });
  });

  it.each([
    [404, "app_not_found"],
    [409, "app_inactive"],
    [401, "app_key_required"],
    [403, "app_key_not_scoped"],
  ])(
    "classifies %s %s as an App access failure with the server message",
    async (status, code) => {
      const client = new AomiClient({
        baseUrl: "https://portal.example",
        fetch: vi.fn().mockResolvedValue(
          Response.json(
            {
              error: {
                code,
                message: "Readable explanation from the server",
                retryable: false,
              },
            },
            { status },
          ),
        ),
        guest: false,
      });
      const error = await client.agent
        .start({ sessionId: "session-1", message: "hello" })
        .catch((value) => value);
      expect(error).toBeInstanceOf(AgentApiError);
      expect(error).toMatchObject({
        status,
        code,
        appAccessCode: code,
        message: "Readable explanation from the server",
        retryable: false,
      });
    },
  );

  it("does not treat other failures as App access failures", () => {
    const error = new AgentApiError(404, "session_not_found", "gone", false);
    expect(error.appAccessCode).toBeUndefined();
    expect(error.message).toBe("gone");
  });

  it("exposes typed session management without a second client", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ sessions: [] }));
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    });
    await expect(client.agent.sessions.list({ limit: 10 })).resolves.toEqual({
      sessions: [],
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://portal.example/v1/agent/sessions?limit=10",
    );
  });

  it("reports each session page as it arrives and stops when aborted", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ sessions: [{ id: "a" }], nextCursor: "next" }),
      )
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBe(controller.signal);
        return Response.json({ sessions: [{ id: "b" }] });
      });
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    });
    const pages: [string[], boolean][] = [];
    const sessions = await client.agent.sessions.all({
      signal: controller.signal,
      onPage: (page, more) =>
        pages.push([page.map((session) => session.id), more]),
    });
    expect(sessions.map((session) => session.id)).toEqual(["a", "b"]);
    expect(pages).toEqual([
      [["a"], true],
      [["b"], false],
    ]);
    controller.abort();
    await expect(
      client.agent.sessions.all({ signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
