import { describe, expect, it, vi } from "vitest";

import type { EdgeEnv } from "./env";
import { handleRequest } from "./handler";

const env: EdgeEnv = {
  BACKEND_ORIGINS: "https://backend.example",
  LANDING_HOSTS: "aomi.dev",
  LANDING_UPSTREAM_ORIGIN: "https://landing.example",
};

function call(method: string, path: string, headers: HeadersInit = {}) {
  const fetchImpl = vi.fn(async (_request: Request) => Response.json({ ok: true }));
  const response = handleRequest(new Request(`https://aomi.dev${path}`, { method, headers }), env, fetchImpl);
  return { fetchImpl, response };
}

describe("Landing surface", () => {
  it.each([
    ["GET", "/api/threads"],
    ["GET", "/api/thread/apps"],
    ["POST", "/api/thread/chat"],
    ["DELETE", "/api/threads/thread-1"],
  ])("forwards %s %s to the backend anonymously", async (method, path) => {
    const { fetchImpl, response } = call(method, path, { authorization: "Bearer caller", cookie: "session=1" });
    expect((await response).status).toBe(200);
    const [forwarded] = fetchImpl.mock.calls[0]!;
    expect(forwarded.url).toBe(`https://backend.example${path}`);
    expect(forwarded.headers.has("authorization")).toBe(false);
    expect(forwarded.headers.has("cookie")).toBe(false);
  });

  it.each([
    ["GET", "/api/sessions"],
    ["PATCH", "/api/sessions/thread-1"],
    ["GET", "/api/account"],
    ["GET", "/api/og"],
  ])("passes %s %s through to Landing", async (method, path) => {
    const { fetchImpl, response } = call(method, path);
    await response;
    expect(fetchImpl.mock.calls[0]![0].url).toBe(`https://landing.example${path}`);
  });
});
