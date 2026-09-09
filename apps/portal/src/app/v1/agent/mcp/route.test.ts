import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  handler: undefined as
    | ((request: Request, claims: Record<string, unknown>) => Promise<Response>)
    | undefined,
  options: undefined as Record<string, unknown> | undefined,
  principal: vi.fn(),
  proxy: vi.fn(),
}));

vi.mock("@aomi-labs/account/better-auth", () => ({ auth: {} }));
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: vi.fn(
    (
      _auth: unknown,
      handler: typeof mocks.handler,
      options: Record<string, unknown>,
    ) => {
      mocks.handler = handler;
      mocks.options = options;
      return async (request: Request) =>
        request.headers.has("authorization")
          ? handler?.(request, { sub: "user-1" })
          : new Response(null, { status: 401 });
    },
  ),
}));
vi.mock("@portal/server/oauth/resources", () => ({
  aomiOAuthResources: () => ({
    agentMcp: "https://chat.aomi.dev/v1/agent/mcp",
  }),
  aomiOAuthResourcePolicy: () => ({
    allowedScopes: ["mcp:agent", "agent:read", "agent:write"],
  }),
}));
vi.mock("@portal/server/oauth/principal", () => ({
  ApiPrincipalError: class ApiPrincipalError extends Error {},
  apiAuthError: vi.fn((error) => {
    mocks.error(error);
    return new Response(null, { status: 403 });
  }),
  principalFromOAuthClaims: mocks.principal,
}));
vi.mock("@portal/server/agent-api-proxy", () => ({
  proxyAgentApi: mocks.proxy,
}));

import { POST } from "./route";

const principal = {
  canonicalUserId: "aomi-user-1",
  resource: "https://chat.aomi.dev/v1/agent/mcp",
  authSource: "oauth",
  principalClass: "user",
  scopes: ["mcp:agent", "agent:read", "agent:write"],
};

describe("canonical Agent MCP route", () => {
  beforeEach(() => {
    mocks.principal.mockResolvedValue(principal);
    mocks.proxy.mockResolvedValue(Response.json({ ok: true }));
  });

  it("configures exact-resource OAuth for every MCP protocol method", async () => {
    expect(mocks.options).toMatchObject({
      resource: "https://chat.aomi.dev/v1/agent/mcp",
      requiredScopes: ["mcp:agent"],
      challengeScopes: [
        "mcp:agent",
        "agent:read",
        "agent:write",
        "offline_access",
      ],
      dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
    });
    for (const method of ["initialize", "tools/list", "tools/call"]) {
      const response = await POST(
        new Request("https://chat.aomi.dev/v1/agent/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        }),
      );
      expect(response.status).toBe(401);
    }
  });

  it("preserves exact-resource scopes and proxies only to the Rust presenter", async () => {
    const request = new Request("https://chat.aomi.dev/v1/agent/mcp", {
      method: "POST",
      headers: { authorization: "Bearer exact-resource-token" },
    });

    const response = await POST(request);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(mocks.principal).toHaveBeenCalledWith(
      { sub: "user-1" },
      "https://chat.aomi.dev/v1/agent/mcp",
    );
    expect(mocks.proxy.mock.calls[0][1]).toMatchObject({
      scopes: ["mcp:agent", "agent:read", "agent:write"],
    });
    expect(new URL(mocks.proxy.mock.calls[0][0].url).pathname).toBe(
      "/v1/agent/mcp",
    );
  });
});
