import { describe, expect, it } from "vitest";
import { widgetAuthRateLimit } from "./rate-limit";
import { widgetRoute } from "./response";

function requestFromIp(ip: string): Request {
  return new Request("http://localhost:3002/api/auth/widget/exchange", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "x-forwarded-for": ip },
  });
}

describe("widgetAuthRateLimit", () => {
  it("allows a conservative burst then returns 429 for the same IP", () => {
    // Unique IP so the shared in-process window is isolated from other tests.
    const ip = "203.0.113.10";
    let last: Response | null = null;
    let firstBlockedAt = -1;
    for (let i = 0; i < 200; i++) {
      const result = widgetAuthRateLimit(requestFromIp(ip));
      if (result && firstBlockedAt === -1) firstBlockedAt = i;
      last = result;
    }
    // Some allowed requests came before the first block, and eventually blocks.
    expect(firstBlockedAt).toBeGreaterThan(0);
    expect(last?.status).toBe(429);
  });

  it("returns null (allowed) for a fresh IP", () => {
    expect(widgetAuthRateLimit(requestFromIp("203.0.113.20"))).toBeNull();
  });

  it("is wrapped with widget CORS headers when returned from a route", async () => {
    const ip = "203.0.113.30";
    const handler = widgetRoute(async (request: Request) => {
      const limited = widgetAuthRateLimit(request);
      return limited ?? Response.json({ ok: true });
    }, "widget.test_rate_limit");
    let response: Response | null = null;
    for (let i = 0; i < 200; i++) {
      response = await handler(requestFromIp(ip));
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response?.headers.get("Vary")).toContain("Origin");
    expect(
      response?.headers.get("Access-Control-Allow-Credentials"),
    ).toBeNull();
  });
});
