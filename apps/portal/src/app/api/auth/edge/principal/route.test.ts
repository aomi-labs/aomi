// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signJWT: vi.fn(), managed: vi.fn() }));

const SESSIONS: Record<string, { user: { id: string; isAnonymous: boolean } }> = {
  user: { user: { id: "ba-user", isAnonymous: false } },
  guest: { user: { id: "ba-guest", isAnonymous: true } },
};

vi.mock("server-only", () => ({}));
vi.mock("@aomi-labs/account/account", () => ({
  getOrCreateAomiUserForBetterAuthSession: async ({ betterAuthUserId }: { betterAuthUserId: string }) => ({
    id: `acct-${betterAuthUserId}`,
  }),
}));
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { api: { signJWT: mocks.signJWT } },
}));
vi.mock("@aomi-labs/account/widget-auth", () => ({
  hasWidgetSessionBearer: (request: Request) =>
    request.headers.get("authorization")?.startsWith("Bearer aomi_wst_") ?? false,
  resolveWidgetSession: async ({ request }: { request: Request }) =>
    request.headers.get("authorization") === "Bearer aomi_wst_ok" &&
    request.headers.get("origin") === "https://partner.example"
      ? {
          userId: "acct-widget",
          origin: "https://partner.example",
          authMethod: "siwe",
          expiresAt: 1_900_000_000,
        }
      : null,
}));
vi.mock("@/server/account/session", () => ({
  getBetterAuthSession: async (request: Request) => {
    const bearer = request.headers.get("authorization")?.split(/\s+/)[1];
    if (bearer) return SESSIONS[bearer] ?? null;
    const cookie = /session=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
    return cookie ? (SESSIONS[cookie] ?? null) : null;
  },
  sessionUserSeed: (session: { user?: { id: string } } | null) =>
    session?.user ? { betterAuthUserId: session.user.id } : null,
}));
vi.mock("@/server/bff/cors", () => ({
  isManagedWidgetClientOrigin: (origin: string | null, clientId?: string) =>
    mocks.managed(origin, clientId),
}));

import { GET as managedOrigin } from "../managed-origin/route";
import { POST } from "./route";

function post(headers: Record<string, string>) {
  return POST(new Request("https://portal.example/api/auth/edge/principal", { method: "POST", headers }));
}

describe("edge principal token", () => {
  it("signs a cookie session as kind cookie with the canonical account", async () => {
    mocks.signJWT.mockResolvedValueOnce({ token: "jwt-1" });
    const response = await post({ cookie: "session=user" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: "jwt-1" });
    const payload = mocks.signJWT.mock.calls.at(-1)![0].body.payload;
    expect(payload).toMatchObject({
      sub: "acct-ba-user",
      kind: "cookie",
      guest: false,
      better_auth_user_id: "ba-user",
      aud: "aomi-edge",
    });
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("marks an explicit Better Auth bearer as session_bearer and guests as guest", async () => {
    mocks.signJWT.mockResolvedValueOnce({ token: "jwt-2" });
    const response = await post({ authorization: "Bearer guest" });
    expect(response.status).toBe(200);
    expect(mocks.signJWT.mock.calls.at(-1)![0].body.payload).toMatchObject({
      sub: "acct-ba-guest",
      kind: "session_bearer",
      guest: true,
    });
  });

  it("answers 204 for no credential or an unknown cookie, 401 for an unknown bearer", async () => {
    expect((await post({})).status).toBe(204);
    expect((await post({ cookie: "session=nobody" })).status).toBe(204);
    const bearer = await post({ authorization: "Bearer nobody" });
    expect(bearer.status).toBe(401);
    expect(await bearer.json()).toEqual({ error: "invalid_token" });
  });

  it("binds a widget session to its origin", async () => {
    mocks.signJWT.mockResolvedValueOnce({ token: "jwt-3" });
    const ok = await post({ authorization: "Bearer aomi_wst_ok", origin: "https://partner.example" });
    expect(ok.status).toBe(200);
    expect(mocks.signJWT.mock.calls.at(-1)![0].body.payload).toMatchObject({
      sub: "acct-widget",
      kind: "widget",
      guest: false,
      origin: "https://partner.example",
      auth_method: "siwe",
      expires_at: 1_900_000_000,
    });
    const wrong = await post({ authorization: "Bearer aomi_wst_ok", origin: "https://other.example" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_widget_session" });
  });

  it("answers the managed-origin question from the OAuth client registry", async () => {
    mocks.managed.mockResolvedValueOnce(true);
    const response = await managedOrigin(
      new Request(
        "https://portal.example/api/auth/edge/managed-origin?client_id=client-1&origin=https%3A%2F%2Fpartner.example",
      ),
    );
    expect(await response.json()).toEqual({ allowed: true });
    expect(mocks.managed).toHaveBeenCalledWith("https://partner.example", "client-1");
  });
});
