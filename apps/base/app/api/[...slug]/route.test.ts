import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RouteContext = { params: Promise<{ slug?: string[] }> };

const ORIGINAL_ENV = { ...process.env };

function context(slug: string[]): RouteContext {
  return { params: Promise.resolve({ slug }) };
}

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

async function loadRoute() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }),
  );

  return import("./route");
}

describe("Base backend proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AOMI_PROXY_BACKEND_URL;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
  });

  it("forwards anonymous-safe demo routes to the explicitly configured backend", async () => {
    process.env.AOMI_PROXY_BACKEND_URL = "https://backend.example";
    const { POST } = await loadRoute();

    const response = await POST(
      request("/api/v1/agent/chat", {
        method: "POST",
        headers: {
          authorization: "Bearer browser-token",
          cookie: "better-auth.session_token=secret",
          "content-type": "application/json",
          "x-session-id": "thread-1",
        },
        body: JSON.stringify({ message: "hello" }),
      }),
      context(["v1", "agent", "chat"]),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [target, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("https://backend.example/v1/agent/chat");
    const headers = init?.headers as Headers;
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-session-id")).toBe("thread-1");
    expect(headers.get("x-thread-id")).toBe("thread-1");
  });

  it("uses only the local backend fallback outside deployed runtimes", async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      request("/api/v1/agent/chat", {
        method: "POST",
        body: "hello",
      }),
      context(["v1", "agent", "chat"]),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [target] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("http://127.0.0.1:8080/v1/agent/chat");
  });

  it("requires an explicit backend URL when deployed", async () => {
    process.env.VERCEL_ENV = "production";
    const { POST } = await loadRoute();

    const response = await POST(
      request("/api/v1/agent/chat", { method: "POST", body: "hello" }),
      context(["v1", "agent", "chat"]),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Backend proxy is not configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid configured backend URLs instead of falling back to production", async () => {
    process.env.AOMI_PROXY_BACKEND_URL = "/";
    const { POST } = await loadRoute();

    const response = await POST(
      request("/api/v1/agent/chat", { method: "POST", body: "hello" }),
      context(["v1", "agent", "chat"]),
    );

    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/account", ["account"]],
    ["POST", "/api/secrets", ["secrets"]],
    ["DELETE", "/api/secrets/openai", ["secrets", "openai"]],
    ["POST", "/api/control/provider-keys", ["control", "provider-keys"]],
    [
      "DELETE",
      "/api/control/provider-keys/openai",
      ["control", "provider-keys", "openai"],
    ],
    ["POST", "/api/thread/model", ["thread", "model"]],
    ["GET", "/api/threads", ["threads"]],
    ["PATCH", "/api/threads/thread-1", ["threads", "thread-1"]],
    ["DELETE", "/api/threads/thread-1", ["threads", "thread-1"]],
  ])("blocks %s %s", async (method, path, slug) => {
    process.env.AOMI_PROXY_BACKEND_URL = "https://backend.example";
    const route = await loadRoute();
    const handler = route[method as "GET" | "POST" | "PATCH" | "DELETE"];

    const response = await handler(request(path, { method }), context(slug));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported API route",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
