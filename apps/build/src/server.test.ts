// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import server from "./server";

type NativeHandler = (input: { request: Request }) => Response;

const mocks = vi.hoisted(() => {
  const handlers: Record<string, NativeHandler> = {
    GET: vi.fn(() => new Response("authenticated result")),
  };
  return {
    events: [] as string[],
    initialization: [] as string[],
    handlers,
    fetch: vi.fn(),
    capture: vi.fn(),
  };
});

vi.mock("./server/bun-compat", () => ({
  registerBunCompatHooks: vi.fn(() => mocks.initialization.push("hooks")),
}));
vi.mock("./sentry.server.config", () => ({}));
vi.mock("./routeTree.gen", () => {
  mocks.initialization.push("routeTree");
  return {
    routeTree: {
      options: {},
      children: [{ options: { server: { handlers: mocks.handlers } } }],
    },
  };
});
vi.mock("./server/bff/failures", () => ({
  buildFailures: {
    handle: (input: unknown) => {
      mocks.events.push("capture");
      mocks.capture(input);
    },
  },
}));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: mocks.fetch },
  createServerEntry: (entry: unknown) => entry,
}));
vi.mock("@sentry/tanstackstart-react", () => ({
  wrapFetchWithSentry: (entry: { fetch: () => Promise<Response> }) => ({
    async fetch() {
      try {
        return await entry.fetch();
      } finally {
        mocks.events.push("flush");
      }
    },
  }),
}));

describe("Build native server entry", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.fetch.mockReset();
    mocks.capture.mockReset();
    vi.mocked(mocks.handlers.GET).mockClear();
  });

  it.each([
    ["/projects/", "GET"],
    ["/api/bff/cli/exchange/", "POST"],
  ])(
    "redirects %s before page or native HTTP dispatch",
    async (path, method) => {
      const response = await server.fetch(
        new Request(`http://localhost${path}?value=a%2Bb`, { method }),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe(
        `${path.slice(0, -1)}?value=a%2Bb`,
      );
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.events).toEqual([]);
    },
  );

  it("dispatches a root URL with its query unchanged", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("root page"));
    const request = new Request("http://localhost/?value=a%2Bb");
    const response = await server.fetch(request);
    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
  });

  it("installs native method defaults after runtime hooks and before matching requests", async () => {
    mocks.fetch.mockImplementation((request: Request) => {
      expect(mocks.initialization).toEqual(["hooks", "routeTree"]);
      const handler = mocks.handlers[request.method] ?? mocks.handlers.ANY;
      return handler({ request });
    });

    const preflight = await server.fetch(
      new Request("http://localhost/api/test", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    const unsupported = await server.fetch(
      new Request("http://localhost/api/test", { method: "POST" }),
    );
    expect(unsupported.status).toBe(405);
    expect(mocks.handlers.GET).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("captures a propagated error before the SDK flushes", async () => {
    const error = new Error("request failed");
    mocks.fetch.mockRejectedValueOnce(error);
    const request = new Request("http://localhost/api/bff/build/runs", {
      method: "POST",
    });
    await expect(server.fetch(request)).rejects.toBe(error);
    expect(mocks.events).toEqual(["capture", "flush"]);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({
      source: "uncaught",
      error,
      context: {
        routeFamily: "/api/bff/build/runs",
        operation: "start.request_error",
        method: "POST",
      },
    });
  });

  it("forwards the native response body, status and existing cache policy", async () => {
    const response = new Response("streamed result", {
      status: 202,
      headers: { "Cache-Control": "no-store", "X-Request-Id": "request-1" },
    });
    mocks.fetch.mockResolvedValueOnce(response);
    const request = new Request("http://localhost/api/bff/build/runs");
    const result = await server.fetch(request);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
    expect(result.body).toBe(response.body);
    expect(result.status).toBe(202);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Request-Id")).toBe("request-1");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["flush"]);
  });

  it("keeps responses private when the handler supplied no cache policy", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    const result = await server.fetch(new Request("http://localhost/projects"));
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
