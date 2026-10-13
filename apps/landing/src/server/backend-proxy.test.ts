// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RouteContext = { params: Promise<{ slug?: string[] }> };

function context(slug: string[]): RouteContext {
  return { params: Promise.resolve({ slug }) };
}

function request(
  path: string,
  init: ConstructorParameters<typeof Request>[1] = {},
): Request {
  return new Request(`http://localhost:3000${path}`, init);
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

  return import("./backend-proxy");
}

describe("Landing backend proxy route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv("AOMI_PROXY_BACKEND_URL", "https://backend.example");
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

  it("rewrites legacy session routes to current backend thread routes", async () => {
    const { PATCH } = await loadRoute();

    const response = await PATCH(
      request("/api/sessions/thread-1", { method: "PATCH" }),
      context(["sessions", "thread-1"]),
    );

    expect(response.status).toBe(200);
    const [target] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("https://backend.example/api/threads/thread-1");
  });

  it("rewrites legacy session app routes to current backend thread app routes", async () => {
    const { GET } = await loadRoute();

    const response = await GET(
      request("/api/session/models"),
      context(["session", "models"]),
    );

    expect(response.status).toBe(200);
    const [target] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe("https://backend.example/api/thread/models");
  });

  it("preserves encoded query values and keeps browser credentials off the backend hop", async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      request("/api/threads?filter=a%2Fb&filter=x+y", {
        headers: {
          authorization: "Bearer browser-secret",
          cookie: "session=browser-secret",
        },
      }),
      context(["threads"]),
    );
    expect(response.status).toBe(200);
    const [target, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(target)).toBe(
      "https://backend.example/api/threads?filter=a%2Fb&filter=x+y",
    );
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
  });

  it("fails closed for unknown routes, unsupported methods and private account routes", async () => {
    const { GET, POST } = await loadRoute();
    expect((await GET(request("/api/admin"), context(["admin"]))).status).toBe(
      404,
    );
    expect(
      (
        await POST(
          request("/api/thread/state", { method: "POST" }),
          context(["thread", "state"]),
        )
      ).status,
    ).toBe(404);
    expect(
      (await GET(request("/api/account"), context(["account"]))).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
