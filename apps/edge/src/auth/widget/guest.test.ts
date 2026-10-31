import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCanonicalUser: vi.fn(),
  issueWidgetSession: vi.fn(),
  signInAnonymous: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@aomi-labs/account/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/account")>()),
  getOrCreateAomiUserForBetterAuthSession: mocks.createCanonicalUser,
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  authServer: () => ({ api: { signInAnonymous: mocks.signInAnonymous, getSession: mocks.getSession } }),
}));
vi.mock("@aomi-labs/account/widget-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/widget-auth")>()),
  issueWidgetSession: mocks.issueWidgetSession,
}));
vi.mock("./rate-limit", () => ({
  WIDGET_BUDGETS: { proof: {}, guest: {} },
  consumeWidgetBudget: async () => null,
}));

import { handleRequest } from "../../handler";

const POST = (request: Request) =>
  handleRequest(request, { PORTAL_HOSTS: "portal.example", PORTAL_UPSTREAM_ORIGIN: "https://pages.example" }, fetch);

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

describe("guest sign-in", () => {
  it.each(["/api/auth/guest"])("returns only an origin-bound widget session to an embed (%s)", async (path) => {
    const response = await POST(
      new Request(`https://portal.example${path}`, {
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

  it.each(["/api/auth/guest"])(
    "gives the portal's own origin a Better Auth guest cookie and bearer (%s)",
    async (path) => {
      mocks.getSession.mockResolvedValue(null);
      mocks.signInAnonymous.mockResolvedValue({
        headers: new Headers({ "set-cookie": "better-auth.session_token=t", "set-auth-token": "t" }),
        response: { token: "t", user: { id: "better-auth-guest" } },
      });
      const response = await POST(
        new Request(`https://portal.example${path}`, { method: "POST", headers: { origin: "https://portal.example" } }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("better-auth.session_token=t");
      await expect(response.json()).resolves.toMatchObject({ token: "t" });
      expect(mocks.issueWidgetSession).not.toHaveBeenCalled();
    },
  );

  it("cannot replace an existing session", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", isAnonymous: false }, session: {} });
    const response = await POST(new Request("https://portal.example/api/auth/guest", { method: "POST" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "session_exists" });
    expect(mocks.signInAnonymous).not.toHaveBeenCalled();
  });
});
