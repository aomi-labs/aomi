// @vitest-environment node
// Fetch plumbing only — node keeps Request/AbortSignal in one realm (jsdom
// mixes undici's Request with its own AbortSignal and the constructor's
// brand check rejects the cross-realm signal).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRequestedAgentConfig,
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

describe("getRequestedAgentConfig", () => {
  it("reads the one canonical slug and its lock flag", () => {
    expect(
      getRequestedAgentConfig("?agent=publisher%2Fname&lock_agent=1"),
    ).toEqual({ agent: "publisher/name", locked: true });
    expect(getRequestedAgentConfig("")).toEqual({ agent: null, locked: false });
  });
});
