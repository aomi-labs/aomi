import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  mint: vi.fn(),
}));
vi.mock("@aomi-labs/account", () => ({ mintAgentApiBearer: mocks.mint }));
vi.mock("@portal/server/oauth/principal", () => ({
  resolveApiPrincipal: mocks.principal,
  apiAuthError: () =>
    Response.json(
      { error: { code: "insufficient_scope" } },
      {
        status: 403,
        headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
      },
    ),
}));
vi.mock("@portal/server/widget-auth/cors", () => ({
  applyWidgetCors: (_request: Request, response: Response) => response,
  widgetCorsPreflight: () => new Response(null, { status: 204 }),
}));
import {
  GET,
  POST,
  DELETE,
} from "@portal/app/v1/account/apps/[[...path]]/route";
import { proxyAccountApi } from "@portal/server/account-api-proxy";

const principal = {
  canonicalUserId: "account-one",
  resource: "https://portal.example/v1/account" as const,
  authSource: "oauth" as const,
  principalClass: "user" as const,
  clientId: "account-client",
  scopes: [
    "account:apps:read",
    "account:apps:write",
    "account:credentials:read",
    "account:credentials:write",
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

afterEach(() => vi.unstubAllEnvs());

describe("account apps public OAuth routes", () => {
  it.each([
    ["GET", "/v1/account/apps", "account:apps:read"],
    ["POST", "/v1/account/apps/42", "account:apps:write"],
    ["DELETE", "/v1/account/apps/42", "account:apps:write"],
    ["GET", "/v1/account/apps/42/secrets", "account:credentials:read"],
    ["POST", "/v1/account/apps/42/secrets", "account:credentials:write"],
    ["DELETE", "/v1/account/apps/42/secrets", "account:credentials:write"],
    [
      "DELETE",
      "/v1/account/apps/42/secrets/API_KEY",
      "account:credentials:write",
    ],
  ])("requires the exact scope for %s %s", async (method, path, scope) => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ ready: true }));
    vi.stubGlobal("fetch", upstream);
    try {
      const handler =
        method === "GET" ? GET : method === "POST" ? POST : DELETE;
      const response = await handler(
        new Request(`https://portal.example${path}`, {
          method,
          headers: {
            authorization: "Bearer external-token",
            cookie: "untrusted=1",
          },
          ...(method === "POST"
            ? { body: JSON.stringify({ secrets: { API_KEY: "test-value" } }) }
            : {}),
        }),
      );
      expect(response.status).toBe(200);
      expect(mocks.principal).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: principal.resource,
          requiredScopes: [scope],
        }),
      );
      const [url, init] = upstream.mock.calls[0];
      expect(String(url)).toBe(`http://api-server:8082${path}`);
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer internal-assertion",
      );
      expect(new Headers(init.headers).has("cookie")).toBe(false);
      expect(mocks.mint).toHaveBeenCalledWith(
        "account-one",
        expect.objectContaining({
          resource: principal.resource,
          scope: principal.scopes.join(" "),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { ...principal, scopes: ["account:credits:read", "account:credits:topup"] },
    { ...principal, scopes: ["account:credentials:read"] },
    { ...principal, scopes: ["account:apps:write"] },
    { ...principal, principalClass: "guest" as const },
  ])(
    "never forwards a guest or Credit Bank grant to app credentials",
    async (restricted) => {
      const upstream = vi.fn();
      const response = await proxyAccountApi(
        new Request("https://portal.example/v1/account/apps/42/secrets", {
          method: "POST",
          body: "{}",
        }),
        restricted,
        upstream,
      );
      expect(response.status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
      expect(mocks.mint).not.toHaveBeenCalled();
    },
  );

  it("returns the OAuth challenge without forwarding rejected credentials", async () => {
    mocks.principal.mockRejectedValueOnce(new Error("insufficient_scope"));
    const response = await GET(
      new Request("https://portal.example/v1/account/apps"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      "insufficient_scope",
    );
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it.each([
    "/v1/account/apps/42/secrets/API_KEY/extra",
    "/v1/account/apps/42",
    "/v1/account/apps/not-an-id/secrets",
    "/v1/account/apps/42/secrets/KEY%2Fname",
  ])(
    "rejects unsupported GET %s before resolving a principal",
    async (path) => {
      const response = await GET(new Request(`https://portal.example${path}`));
      expect(response.status).toBe(404);
      expect(mocks.principal).not.toHaveBeenCalled();
    },
  );
});
