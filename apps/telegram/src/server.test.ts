// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import server from "./server";

type NativeHandler = (input: { request: Request }) => Response;
const mocks = vi.hoisted(() => ({
  initialized: false,
  handlers: { POST: vi.fn(() => new Response("verified launch")) } as Record<
    string,
    NativeHandler
  >,
  fetch: vi.fn(),
}));

vi.mock("./routeTree.gen", () => {
  mocks.initialized = true;
  return {
    routeTree: {
      options: {},
      children: [{ options: { server: { handlers: mocks.handlers } } }],
    },
  };
});
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: mocks.fetch },
  createServerEntry: (entry: unknown) => entry,
}));

describe("Telegram native server entry", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.mocked(mocks.handlers.POST).mockClear();
  });

  it("installs launch method contracts before native request matching", async () => {
    mocks.fetch.mockImplementation((request: Request) => {
      expect(mocks.initialized).toBe(true);
      const handler = mocks.handlers[request.method] ?? mocks.handlers.ANY;
      return handler({ request });
    });
    const preflight = await server.fetch(
      new Request("http://localhost/api/telegram/launch", {
        method: "OPTIONS",
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Allow")).toBe("OPTIONS, POST");
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const response = await server.fetch(
        new Request("http://localhost/api/telegram/launch", { method }),
      );
      expect(response.status).toBe(405);
    }
    expect(mocks.handlers.POST).not.toHaveBeenCalled();
  });

  it("redirects a trailing slash before verifying or consuming a launch proof", async () => {
    const request = new Request(
      "http://localhost/api/telegram/launch/?bot_id=001&session_id=telegram%3Adm%3A7",
      {
        method: "POST",
        body: "raw launch body",
      },
    );
    const response = await server.fetch(request);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "/api/telegram/launch?bot_id=001&session_id=telegram%3Adm%3A7",
    );
    expect(request.bodyUsed).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.handlers.POST).not.toHaveBeenCalled();
  });

  it("forwards a canonical launch response and no-store policy unchanged", async () => {
    const expected = Response.json(
      { telegramUserId: "7", authDate: 1_800_000_000 },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
    mocks.fetch.mockResolvedValueOnce(expected);
    const request = new Request("http://localhost/api/telegram/launch", {
      method: "POST",
      body: "proof",
    });
    const response = await server.fetch(request);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
    expect(response).toBe(expected);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      telegramUserId: "7",
      authDate: 1_800_000_000,
    });
  });

  it("forwards the root launch query without a redirect", async () => {
    const expected = new Response("wallet shell");
    mocks.fetch.mockResolvedValueOnce(expected);
    const request = new Request(
      "http://localhost/?bot_id=001&session_id=telegram%3Adm%3A7",
    );
    expect(await server.fetch(request)).toBe(expected);
    expect(mocks.fetch).toHaveBeenCalledWith(request, undefined);
  });
});
