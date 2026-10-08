// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const consume = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/account/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/rate-limit")>()),
  accountRateLimitStorage: { consume },
}));
vi.mock("@/server/bff/failures", () => ({
  portalFailures: {
    handle: (input: { response?: { status: number; error: string } }) => ({
      response: Response.json(
        { error: input.response?.error },
        { status: input.response?.status ?? 500 },
      ),
    }),
  },
}));
import { routes } from "@/server/bff/routes";
import { consumeWidgetBudget, WIDGET_BUDGETS } from "./rate-limit";

const request = (host = "portal.example") =>
  new Request(`https://${host}/api/auth/widget/guest`, {
    method: "POST",
    headers: {
      origin: "https://partner.example",
      "x-vercel-forwarded-for": "203.0.113.20",
    },
  });

describe("widget sign-in budgets", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", "postgres://unused");
    vi.stubEnv("AOMI_CLIENT_IP_HEADER", "");
    consume.mockReset().mockResolvedValue({ allowed: true, retryAfter: null });
  });

  it.each([
    ["proof", WIDGET_BUDGETS.proof, { window: 60, max: 60 }],
    ["guest", WIDGET_BUDGETS.guest, { window: 3600, max: 10 }],
  ])("counts %s attempts per client IP", async (name, budget, rule) => {
    expect(await consumeWidgetBudget(request(), budget)).toBeNull();
    expect(consume).toHaveBeenLastCalledWith(
      `widget:${name}:203.0.113.20`,
      rule,
    );
  });

  it("does not trust forwarding headers outside Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    await consumeWidgetBudget(request(), WIDGET_BUDGETS.guest);
    expect(consume).toHaveBeenLastCalledWith("widget:guest:unknown", {
      window: 3600,
      max: 10,
    });
  });

  it("trusts the header a self-hosted portal names", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("AOMI_CLIENT_IP_HEADER", "X-Real-IP");
    const req = request();
    req.headers.set("x-real-ip", "198.51.100.7");
    await consumeWidgetBudget(req, WIDGET_BUDGETS.proof);
    expect(consume).toHaveBeenLastCalledWith("widget:proof:198.51.100.7", {
      window: 60,
      max: 60,
    });
  });

  it("gives local test browsers sharing loopback the proof budget", async () => {
    vi.stubEnv("VERCEL", "");
    await consumeWidgetBudget(request("127.0.0.1"), WIDGET_BUDGETS.guest);
    expect(consume).toHaveBeenLastCalledWith("widget:guest:unknown", {
      window: 60,
      max: 60,
    });
  });

  it("answers 429 with Retry-After and a readable origin", async () => {
    consume.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const response = await routes.widgetGuest.POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://partner.example",
    );
  });

  it("does not create guests when the store is unavailable", async () => {
    consume.mockRejectedValue(new Error("database unavailable"));
    const response = await routes.widgetGuest.POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("database");
  });
});
