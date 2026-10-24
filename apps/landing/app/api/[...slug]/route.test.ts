import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RouteContext = { params: Promise<{ slug?: string[] }> };

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

describe("Landing backend proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.BACKEND_URL = "https://backend.example";
  });

  it("forwards current thread collection routes used by the SDK", async () => {
    const { GET } = await loadRoute();

    const response = await GET(request("/api/threads"), context(["threads"]));

    expect(response.status).toBe(200);
    const [target] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("https://backend.example/api/threads");
  });

  it("forwards current thread app routes used by the SDK", async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      request("/api/thread/apps"),
      context(["thread", "apps"]),
    );

    expect(response.status).toBe(200);
    const [target] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("https://backend.example/api/thread/apps");
  });

  it.each([
    ["GET", "/api/sessions"],
    ["POST", "/api/sessions"],
    ["PATCH", "/api/sessions/thread-1"],
    ["GET", "/api/session/apps"],
    ["GET", "/api/session/models"],
    ["POST", "/api/session/model"],
  ])("rejects removed %s %s aliases without forwarding", async (method, path) => {
    const handlers = await loadRoute();
    const response = await handlers[method as "GET" | "POST" | "PATCH"](
      request(path, { method }),
      context(path.slice("/api/".length).split("/")),
    );
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
