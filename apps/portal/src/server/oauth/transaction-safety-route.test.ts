import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), mint: vi.fn() }));
vi.mock("@aomi-labs/account", () => ({ mintAgentApiBearer: mocks.mint }));
vi.mock("@portal/server/oauth/principal", () => ({
  resolveApiPrincipal: mocks.principal,
  apiAuthError: () =>
    Response.json({ error: { code: "insufficient_scope" } }, { status: 403 }),
}));
vi.mock("@portal/server/widget-auth/cors", () => ({
  applyWidgetCors: (_request: Request, response: Response) => response,
  widgetCorsPreflight: () => new Response(null, { status: 204 }),
}));
import {
  GET,
  PUT,
} from "@portal/app/v1/account/transaction-safety/[[...path]]/route";
import { proxyAccountApi } from "@portal/server/account-api-proxy";
const principal = {
  canonicalUserId: "account-one",
  resource: "https://portal.example/v1/account" as const,
  authSource: "oauth" as const,
  principalClass: "user" as const,
  clientId: "account-client",
  scopes: [
    "account:transaction-safety:read",
    "account:transaction-safety:write",
  ],
};
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://test.invalid/aomi");
  vi.stubEnv("BETTER_AUTH_URL", "https://portal.example");
  vi.stubEnv("AOMI_AGENT_API_URL", "http://api-server:8082");
  mocks.principal.mockReset().mockResolvedValue(principal);
  mocks.mint.mockReset().mockResolvedValue({ bearer: "internal-assertion" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("transaction safety control plane", () => {
  it.each([
    ["GET", "/v1/account/transaction-safety", "read"],
    ["PUT", "/v1/account/transaction-safety/threads/owner-thread", "write"],
  ])("requires exact scope for %s %s", async (method, path, operation) => {
    const upstream = vi
      .fn()
      .mockResolvedValue(Response.json({ mode: "balanced", revision: 2 }));
    vi.stubGlobal("fetch", upstream);
    const response = await (method === "GET" ? GET : PUT)(
      new Request(`https://portal.example${path}`, {
        method,
        headers: { authorization: "Bearer external", cookie: "untrusted=1" },
        ...(method === "PUT"
          ? {
              body: JSON.stringify({
                mode: "guarded_only",
                expectedRevision: 1,
              }),
            }
          : {}),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.principal).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredScopes: [`account:transaction-safety:${operation}`],
      }),
    );
    expect(String(upstream.mock.calls[0][0])).toBe(
      `http://api-server:8082${path}`,
    );
    const headers = new Headers(upstream.mock.calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer internal-assertion");
    expect(headers.has("cookie")).toBe(false);
  });
  it("rejects control-plane writes for an app principal and unrelated scopes", async () => {
    const request = new Request(
      "https://portal.example/v1/account/transaction-safety",
      { method: "PUT", body: "{}" },
    );
    const upstream = vi.fn();
    expect(
      (
        await proxyAccountApi(
          request,
          { ...principal, principalClass: "app" },
          upstream,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await proxyAccountApi(
          request,
          { ...principal, scopes: ["account:credits:read"] },
          upstream,
        )
      ).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
