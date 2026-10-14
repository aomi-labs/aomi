// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./bearer", () => ({ mintAccountBearer: vi.fn() }));

import { mintAccountBearer } from "./bearer";
import { createBackendProxy, type AllowedRoute } from "./proxy";

const mintMock = vi.mocked(mintAccountBearer);
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function proxyRequest(path: string, init?: NextRequestInit) {
  const url = new URL(`https://portal.aomi.dev${path}`);
  const slug = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
  return [
    new NextRequest(url, init),
    { params: Promise.resolve({ slug }) },
  ] as const;
}

function createTestProxy(options: {
  allowedRoutes: ReadonlyArray<AllowedRoute>;
  resolveCanonicalUserId: () => Promise<string | null>;
  observeFailure?: Parameters<typeof createBackendProxy>[0]["observeFailure"];
}) {
  return createBackendProxy({
    allowedRoutes: options.allowedRoutes,
    upstreamBaseUrl: "https://backend.aomi.dev",
    resolveCanonicalUserId: options.resolveCanonicalUserId,
    observeFailure: options.observeFailure,
  });
}

describe("createBackendProxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed when a session resolves but bearer minting fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mintMock.mockRejectedValue(new Error("signing key missing"));
    const observeFailure = vi.fn();
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/account$/,
          methods: new Set(["GET"]),
        },
      ],
      resolveCanonicalUserId: async () => "user-123",
      observeFailure,
    });

    const response = await GET(...proxyRequest("/api/account"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "bearer_mint_failed",
    });
    expect(observeFailure).toHaveBeenCalledWith({
      kind: "bearer_mint",
      error: expect.objectContaining({ message: "signing key missing" }),
      method: "GET",
      pathname: "/api/account",
      responseStatus: 502,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the original upstream request exception without changing the response", async () => {
    const failure = new Error("socket exposed a secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(failure)),
    );
    const observeFailure = vi.fn();
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/account$/,
          methods: new Set(["GET"]),
          auth: "none",
        },
      ],
      resolveCanonicalUserId: async () => null,
      observeFailure,
    });

    const response = await GET(...proxyRequest("/api/account"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Upstream request failed",
    });
    expect(observeFailure).toHaveBeenCalledWith({
      kind: "upstream_request",
      error: failure,
      method: "GET",
      pathname: "/api/account",
      responseStatus: 502,
    });
  });

  it("does not let an observer failure alter the proxy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "private" }, { status: 503 })),
    );
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/account$/,
          methods: new Set(["GET"]),
          auth: "none",
        },
      ],
      resolveCanonicalUserId: async () => null,
      observeFailure: () => {
        throw new Error("telemetry unavailable");
      },
    });

    const response = await GET(...proxyRequest("/api/account"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "private" });
  });

  it("does not let an async observer rejection alter the proxy response", async () => {
    const rejection = Promise.reject(new Error("telemetry unavailable"));
    const catchSpy = vi.spyOn(rejection, "catch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "private" }, { status: 503 })),
    );
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/account$/,
          methods: new Set(["GET"]),
          auth: "none",
        },
      ],
      resolveCanonicalUserId: async () => null,
      observeFailure: () => rejection,
    });

    const response = await GET(...proxyRequest("/api/account"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "private" });
    expect(catchSpy).toHaveBeenCalledOnce();
    await rejection.catch(() => {});
  });

  it("still forwards explicitly public routes anonymously", async () => {
    const fetchMock = vi.fn(async (_input: URL, _init?: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/health$/,
          methods: new Set(["GET"]),
          auth: "optional",
        },
      ],
      resolveCanonicalUserId: async () => null,
    });

    const response = await GET(
      ...proxyRequest("/api/health", {
        headers: {
          authorization: "Bearer user-supplied",
          cookie: "better-auth.session_token=session",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("Expected upstream fetch init");
    const headers = new Headers(init.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });

  it("does not resolve a session for bearer-independent public routes", async () => {
    const fetchMock = vi.fn(async (_input: URL, _init?: RequestInit) =>
      Response.json(["Gemini 3 Flash"]),
    );
    const resolveCanonicalUserId = vi.fn(async () => "user-123");
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/thread\/models$/,
          methods: new Set(["GET"]),
          auth: "none",
        },
      ],
      resolveCanonicalUserId,
    });

    const response = await GET(
      ...proxyRequest("/api/thread/models", {
        headers: {
          authorization: "Bearer user-supplied",
          cookie: "better-auth.session_token=session",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(["Gemini 3 Flash"]);
    expect(resolveCanonicalUserId).not.toHaveBeenCalled();
    expect(mintMock).not.toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("Expected upstream fetch init");
    const headers = new Headers(init.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });

  it("rejects protected routes instead of forwarding without Authorization", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/account$/,
          methods: new Set(["GET"]),
        },
      ],
      resolveCanonicalUserId: async () => null,
    });

    const response = await GET(...proxyRequest("/api/account"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards x402 payment proofs without forwarding browser credentials", async () => {
    const fetchMock = vi.fn(async (_input: URL, _init?: RequestInit) =>
      Response.json(
        { ok: true },
        { headers: { "payment-response": "settlement-receipt" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/chat$/,
          methods: new Set(["POST"]),
          auth: "optional",
        },
      ],
      resolveCanonicalUserId: async () => null,
    });

    const response = await POST(
      ...proxyRequest("/api/chat", {
        method: "POST",
        headers: {
          authorization: "Bearer user-supplied",
          cookie: "better-auth.session_token=session",
          "payment-signature": "signed-payment",
          "x-unsupported": "drop-me",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("payment-response")).toBe("settlement-receipt");
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("Expected upstream fetch init");
    const headers = new Headers(init.headers);
    expect(headers.get("payment-signature")).toBe("signed-payment");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("x-unsupported")).toBe(false);
  });

  it("returns chained x402 settlement and challenge headers", async () => {
    const fetchMock = vi.fn(
      async (_input: URL, _init?: RequestInit) =>
        new Response(null, {
          status: 402,
          headers: {
            "payment-required": "platform-challenge",
            "payment-response": "partner-settlement-receipt",
            "www-authenticate": 'Payment realm="mpp"',
            "x-upstream-internal": "drop-me",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = createTestProxy({
      allowedRoutes: [
        {
          pattern: /^\/api\/chat$/,
          methods: new Set(["POST"]),
          auth: "optional",
        },
      ],
      resolveCanonicalUserId: async () => null,
    });

    const response = await POST(
      ...proxyRequest("/api/chat", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBe("platform-challenge");
    expect(response.headers.get("payment-response")).toBe(
      "partner-settlement-receipt",
    );
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(response.headers.has("x-upstream-internal")).toBe(false);
  });
});
