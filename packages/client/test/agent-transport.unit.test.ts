import { describe, expect, it, vi } from "vitest";

import { AgentApiError, AomiClient } from "../src";

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
        inferenceFunding: "user_byok",
      },
    );
    await agent.poll("session-1", { cursor: "cursor-1", waitMs: 40_000 });

    expect(fetch.mock.calls[0][0]).toBe("https://portal.example/v1/agent/chat");
    const startHeaders = new Headers(fetch.mock.calls[0][1].headers);
    expect(startHeaders.get("idempotency-key")).toBe("idem-fixed");
    expect(startHeaders.get("payment-signature")).toBe("payment");
    expect(startHeaders.get("x-aomi-inference-funding")).toBe("user_byok");
    expect(startHeaders.get("x-session-id")).toBe("session-1");
    expect(startHeaders.get("x-thread-id")).toBe("session-1");
    expect(fetch.mock.calls[1][0]).toBe(
      "https://portal.example/v1/agent/chat/session-1?cursor=cursor-1&wait=30000",
    );
    const pollHeaders = new Headers(fetch.mock.calls[1][1].headers);
    expect(pollHeaders.get("x-session-id")).toBe("session-1");
    expect(pollHeaders.get("x-thread-id")).toBe("session-1");
  });

  it("applies the client funding default to Agent turns", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ events: [], has_more: false }));
    const client = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
      inferenceFunding: "user_byok",
    });

    await client.agent.start({ sessionId: "session-1", message: "hello" });

    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("x-aomi-inference-funding")).toBe("user_byok");
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
});
