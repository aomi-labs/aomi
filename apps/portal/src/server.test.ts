// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import server from "./server";

type NativeHandler = (input: { request: Request }) => Response;

const mocks = vi.hoisted(() => {
  const handlers: Record<string, NativeHandler> = {
    POST: vi.fn(() => new Response("authenticated result")),
  };
  return {
    events: [] as string[],
    handlers,
    fetch: vi.fn(),
    proxy: vi.fn(),
    capture: vi.fn(),
  };
});

vi.mock("./proxy", () => ({
  proxy: mocks.proxy,
}));
vi.mock("./sentry.server.config", () => ({}));
vi.mock("./routeTree.gen", () => ({
  routeTree: {
    options: {},
    children: [{ options: { server: { handlers: mocks.handlers } } }],
  },
}));
vi.mock("./server/bff/failures", () => ({
  portalFailures: {
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

describe("Portal native server entry", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.fetch.mockReset();
    mocks.proxy.mockReset();
    mocks.proxy.mockResolvedValue(null);
    mocks.capture.mockReset();
    vi.mocked(mocks.handlers.POST).mockClear();
  });

  it.each([
    ["/settings/", "GET"],
    ["/openapi.json/", "GET"],
    ["/v1/account/", "POST"],
    ["/deployments/new/", "GET"],
  ])(
    "redirects %s before page, proxy, native or legacy dispatch",
    async (path, method) => {
      const response = await server.fetch(
        new Request(`http://localhost${path}?value=a%2Bb`, { method }),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe(
        `${path.slice(0, -1)}?value=a%2Bb`,
      );
      expect(mocks.proxy).not.toHaveBeenCalled();
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
    expect(mocks.proxy).not.toHaveBeenCalled();
  });

  it("installs method defaults before dispatching native routes", async () => {
    mocks.fetch.mockImplementation((request: Request) => {
      const handler = mocks.handlers[request.method] ?? mocks.handlers.ANY;
      return handler({ request });
    });

    const preflight = await server.fetch(
      new Request("http://localhost/v1/account/test", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Allow")).toBe("OPTIONS, POST");
    const unsupported = await server.fetch(
      new Request("http://localhost/v1/account/test"),
    );
    expect(unsupported.status).toBe(405);
    expect(mocks.handlers.POST).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("captures a propagated error before the SDK flushes", async () => {
    const error = new Error("request failed");
    mocks.fetch.mockRejectedValueOnce(error);
    const request = new Request("http://localhost/api/bff/threads", {
      method: "POST",
    });
    await expect(server.fetch(request)).rejects.toBe(error);
    expect(mocks.events).toEqual(["capture", "flush"]);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({
      source: "uncaught",
      error,
      context: {
        routeFamily: "/api/bff/threads",
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
    const request = new Request("http://localhost/api/bff/threads");
    const result = await server.fetch(request);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
    expect(result.body).toBe(response.body);
    expect(result.status).toBe(202);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Request-Id")).toBe("request-1");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.events).toEqual(["flush"]);
  });

  it("captures an upstream proxy failure before the SDK flushes", async () => {
    const error = new Error("upstream failed");
    mocks.proxy.mockRejectedValueOnce(error);
    await expect(
      server.fetch(new Request("http://localhost/v1/agent")),
    ).rejects.toBe(error);
    expect(mocks.events).toEqual(["capture", "flush"]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("forwards an authorized proxy stream without calling the page handler", async () => {
    const response = new Response("proxy stream", {
      status: 201,
      headers: { "X-Request-Id": "proxy-1" },
    });
    mocks.proxy.mockResolvedValueOnce(response);
    const request = new Request("http://localhost/v1/agent");
    const result = await server.fetch(request);
    expect(mocks.proxy).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result).toBe(response);
    expect(mocks.events).toEqual(["flush"]);
  });
});
