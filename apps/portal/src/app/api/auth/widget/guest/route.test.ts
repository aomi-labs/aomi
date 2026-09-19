import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCanonicalUser: vi.fn(),
  issueWidgetSession: vi.fn(),
  signInAnonymous: vi.fn(),
}));

vi.mock("@aomi-labs/account/account", () => ({
  getOrCreateAomiUserForBetterAuthSession: mocks.createCanonicalUser,
}));
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { api: { signInAnonymous: mocks.signInAnonymous } },
}));
vi.mock("@aomi-labs/account/widget-auth", () => ({
  issueWidgetSession: mocks.issueWidgetSession,
  requireWidgetOrigin: (request: Request) => request.headers.get("origin"),
}));
vi.mock("@portal/server/widget-auth/rate-limit", () => ({
  widgetAuthRateLimit: () => null,
}));
vi.mock("@portal/server/widget-auth/response", () => ({
  widgetRoute: (handler: (request: Request) => Promise<Response>) => handler,
  widgetPreflight: () => () => new Response(null, { status: 204 }),
  widgetSessionResponse: (session: { token: string; userId: string }) =>
    Response.json({
      access_token: session.token,
      user: { id: session.userId },
    }),
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.signInAnonymous.mockReset().mockResolvedValue({
    token: "unexposed-better-auth-token",
    user: {
      id: "better-auth-guest",
      email: "guest@example.test",
      emailVerified: false,
      name: "Anonymous",
      image: null,
    },
  });
  mocks.createCanonicalUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.issueWidgetSession.mockReset().mockResolvedValue({
    token: "aomi_wst_guest",
    userId: "user-1",
  });
});

describe("widget guest bootstrap", () => {
  it("returns only an origin-bound widget session", async () => {
    const response = await POST(
      new Request("https://portal.example/api/auth/widget/guest", {
        method: "POST",
        headers: {
          origin: "https://partner.example",
          referer: "https://partner.example/app",
        },
      }),
    );

    expect(response.status).toBe(200);
    const authHeaders = mocks.signInAnonymous.mock.calls[0]?.[0]
      ?.headers as Headers;
    expect(authHeaders.get("origin")).toBeNull();
    expect(authHeaders.get("referer")).toBeNull();
    expect(mocks.issueWidgetSession).toHaveBeenCalledWith({
      userId: "user-1",
      origin: "https://partner.example",
      authMethod: "anonymous",
    });
    await expect(response.json()).resolves.toEqual({
      access_token: "aomi_wst_guest",
      user: { id: "user-1" },
    });
  });
});
