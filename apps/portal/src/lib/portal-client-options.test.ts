// @vitest-environment node
// Fetch plumbing only — node keeps Request/AbortSignal in one realm (jsdom
// mixes undici's Request with its own AbortSignal and the constructor's
// brand check rejects the cross-realm signal).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLockedAppScope,
  getRequestedAppConfig,
  withDebugLogging,
} from "./portal-client-options";

const PAGE_HREF = "http://localhost:3000/";

beforeEach(() => {
  vi.stubGlobal("window", { location: { href: PAGE_HREF } });
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

describe("withDebugLogging", () => {
  it("passes Request inputs through untouched", async () => {
    // Regression: rebuilding via `new Request(url, request)` treated the
    // Request as a RequestInit, turning its buffered body into a stream —
    // POST /api/exec/simulate then left the page with an empty body (or died
    // with ERR_ALPN_NEGOTIATION_FAILED on plain-http localhost).
    const seen: Array<RequestInfo | URL> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(input);
      return new Response("{}", { status: 200 });
    });
    const wrapped = withDebugLogging(
      "test.fetch",
      fetchImpl as unknown as typeof fetch,
    );

    const request = new Request("http://localhost:3000/api/exec/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"transactions":[]}',
    });
    await wrapped(request);

    expect(seen).toEqual([request]);
    expect(request.bodyUsed).toBe(false);
    expect(await request.clone().text()).toBe('{"transactions":[]}');
  });

  it("resolves string inputs against the page origin and forwards init", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const wrapped = withDebugLogging(
      "test.fetch",
      fetchImpl as unknown as typeof fetch,
    );

    const init: RequestInit = { method: "POST", body: '{"a":1}' };
    await wrapped("/api/exec/simulate", init);

    const [input, forwardedInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(input).toBe(new URL("/api/exec/simulate", PAGE_HREF).toString());
    expect(forwardedInit).toBe(init);
  });
});

describe("applyLockedAppScope", () => {
  it("pins app params on string inputs for send-path routes", async () => {
    const result = await applyLockedAppScope(
      "http://localhost:3000/v1/agent/chat",
      "my-app",
      "app-123",
    );
    const url = new URL(String(result));
    expect(url.searchParams.get("app")).toBe("my-app");
    expect(url.searchParams.get("application_id")).toBe("app-123");
  });

  it("rewrites Request inputs without losing the buffered body", async () => {
    const request = new Request("http://localhost:3000/v1/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"message":"hi"}',
    });
    const result = (await applyLockedAppScope(
      request,
      "my-app",
      null,
    )) as Request;

    expect(result).toBeInstanceOf(Request);
    expect(new URL(result.url).searchParams.get("app")).toBe("my-app");
    expect(result.method).toBe("POST");
    expect(result.headers.get("Content-Type")).toBe("application/json");
    // The rebuilt body must be buffered (clone-able), not a one-shot stream.
    expect(await result.clone().text()).toBe('{"message":"hi"}');
    expect(await result.text()).toBe('{"message":"hi"}');
    // And the caller's Request stays usable.
    expect(request.bodyUsed).toBe(false);
  });

  it("leaves non-send-path routes and unlocked sessions alone", async () => {
    const request = new Request("http://localhost:3000/api/exec/simulate", {
      method: "POST",
      body: "{}",
    });
    expect(await applyLockedAppScope(request, "my-app", null)).toBe(request);
    expect(
      await applyLockedAppScope(
        "http://localhost:3000/api/v1/agent/chat",
        null,
        null,
      ),
    ).toBe("http://localhost:3000/api/v1/agent/chat");
  });
});

describe("getRequestedAppConfig", () => {
  it("reads app and lock flags from the query string", () => {
    expect(getRequestedAppConfig("?app=foo&lock_app=1")).toEqual({
      app: "foo",
      applicationId: null,
      locked: true,
    });
  });

  it("accepts an explicit inference funding lane", () => {
    expect(getRequestedAppConfig("?funding=user_byok").inferenceFunding).toBe(
      "user_byok",
    );
    expect(getRequestedAppConfig("?funding=unknown").inferenceFunding).toBe(
      undefined,
    );
  });
});
