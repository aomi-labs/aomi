// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_API_HEADERS,
  BACKEND_API_HEADERS,
  PUBLIC_DISCOVERY_HEADERS,
  UpstreamUnreachableError,
  forward,
  type HeaderPolicy,
} from "./forward";

const UPSTREAM_HEADERS = {
  "content-type": "application/json",
  "cache-control": "private, max-age=5",
  "cdn-cache-control": "public, max-age=1800",
  "vercel-cdn-cache-control": "public, max-age=1800",
  etag: '"v1"',
  location: "/api/threads/t2",
  "payment-required": "challenge",
  "payment-receipt": "receipt",
  "payment-response": "settlement",
  "retry-after": "3",
  "server-timing": "db;dur=1",
  "x-accel-buffering": "no",
  "x-request-id": "req-1",
  "mcp-protocol-version": "2026-06-18",
  "set-cookie": "upstream=1",
  "www-authenticate": 'Payment realm="x"',
  "x-internal": "drop",
};

async function forwarded(
  policy: HeaderPolicy,
  init: RequestInit = {},
  upstream: Response = new Response("{}", {
    status: 200,
    headers: UPSTREAM_HEADERS,
  }),
) {
  const fetchImpl = vi.fn(async () => upstream);
  const request = new Request("https://portal.example/api/thread/chat?x=1", {
    ...init,
    headers: {
      cookie: "better-auth.session_token=secret",
      authorization: "Bearer caller",
      origin: "https://partner.example",
      accept: "application/json",
      "content-type": "application/json",
      "payment-signature": "signed",
      "x-session-id": "thread-1",
      "idempotency-key": "k1",
      "x-unlisted": "drop",
      ...(init.headers as Record<string, string>),
    },
  });
  const response = await forward({
    request,
    url: new URL("https://upstream.example/api/thread/chat?x=1"),
    policy,
    bearer: "minted",
    fetchImpl,
  });
  const [, sent] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
  return { response, sent, headers: new Headers(sent.headers) };
}

describe("forward", () => {
  it.each([
    [
      "backend /api",
      BACKEND_API_HEADERS,
      [
        "accept",
        "content-type",
        "payment-signature",
        "x-session-id",
        "x-thread-id",
      ],
    ],
    [
      "agent API",
      AGENT_API_HEADERS,
      [
        "accept",
        "content-type",
        "payment-signature",
        "x-session-id",
        "x-thread-id",
        "idempotency-key",
      ],
    ],
  ])(
    "%s: sends only its request headers and the minted bearer",
    async (_name, policy, expected) => {
      const { headers } = await forwarded(policy);
      expect([...headers.keys()].sort()).toEqual(
        [...expected, "authorization"].sort(),
      );
      expect(headers.get("authorization")).toBe("Bearer minted");
      expect(headers.get("x-thread-id")).toBe("thread-1");
    },
  );

  it.each([
    ["backend /api", BACKEND_API_HEADERS, false],
    ["agent API", AGENT_API_HEADERS, true],
  ])(
    "%s: returns payment, redirect and cache headers but never CDN directives",
    async (_name, policy, mcp) => {
      const { response } = await forwarded(policy);
      for (const name of [
        "payment-required",
        "payment-receipt",
        "payment-response",
        "location",
        "retry-after",
        "etag",
        "cache-control",
        "x-request-id",
        "server-timing",
      ])
        expect(response.headers.has(name)).toBe(true);
      for (const name of [
        "cdn-cache-control",
        "vercel-cdn-cache-control",
        "set-cookie",
        "www-authenticate",
        "x-internal",
      ])
        expect(response.headers.has(name)).toBe(false);
      expect(response.headers.has("mcp-protocol-version")).toBe(mcp);
    },
  );

  it("lets public discovery keep its CDN directives", async () => {
    const { response, headers } = await forwarded(PUBLIC_DISCOVERY_HEADERS);
    expect(response.headers.get("cdn-cache-control")).toBe(
      "public, max-age=1800",
    );
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("payment-signature")).toBe(false);
  });

  it("marks event streams uncacheable", async () => {
    const stream = new Response("data: {}\n\n", {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "public, max-age=60",
        "cdn-cache-control": "public",
      },
    });
    const { response } = await forwarded(PUBLIC_DISCOVERY_HEADERS, {}, stream);
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.headers.has("cdn-cache-control")).toBe(false);
  });

  it("keeps redirects for the browser instead of following them", async () => {
    const { response, sent } = await forwarded(
      BACKEND_API_HEADERS,
      {},
      new Response(null, { status: 302, headers: { location: "/elsewhere" } }),
    );
    expect(sent.redirect).toBe("manual");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/elsewhere");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "does not let a client disconnect abort a %s upstream",
    async (method) => {
      const { sent } = await forwarded(BACKEND_API_HEADERS, {
        method,
        body: "{}",
      });
      expect(sent.signal).toBeUndefined();
    },
  );

  it("stops a read when the client disconnects", async () => {
    const { sent } = await forwarded(BACKEND_API_HEADERS);
    expect(sent.signal).toBeInstanceOf(AbortSignal);
  });

  it("tells an unreachable upstream apart from an upstream error", async () => {
    await expect(
      forward({
        request: new Request("https://portal.example/api/x"),
        url: new URL("https://upstream.example/api/x"),
        policy: BACKEND_API_HEADERS,
        fetchImpl: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    ).rejects.toBeInstanceOf(UpstreamUnreachableError);
  });
});
