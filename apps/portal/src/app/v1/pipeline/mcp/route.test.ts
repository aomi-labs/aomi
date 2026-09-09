import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
    pipelineMcp: "https://chat.aomi.dev/v1/pipeline/mcp",
  }),
  aomiOAuthResourcePolicy: () => ({
    allowedScopes: [
      "mcp:pipeline",
      "pipeline:catalog",
      "pipeline:execute",
      "payments:submit",
      "custody:delegate",
    ],
  }),
}));
vi.mock("@portal/server/oauth/principal", () => ({
  ApiPrincipalError: class ApiPrincipalError extends Error {},
  apiAuthError: vi.fn(() => new Response(null, { status: 403 })),
  principalFromOAuthClaims: mocks.principal,
}));
vi.mock("@portal/server/agent-api-proxy", () => ({
  proxyAgentApi: mocks.proxy,
}));

import { POST } from "./route";

const principal = {
  canonicalUserId: "aomi-user-1",
  resource: "https://chat.aomi.dev/v1/pipeline/mcp",
  authSource: "oauth",
  principalClass: "user",
  scopes: ["mcp:pipeline", "pipeline:catalog"],
};

describe("canonical Pipeline MCP route", () => {
  beforeEach(() => {
    mocks.principal.mockResolvedValue(principal);
    mocks.proxy.mockResolvedValue(Response.json({ ok: true }));
  });

  it("configures exact-resource OAuth for every MCP protocol method", async () => {
    expect(mocks.options).toMatchObject({
      resource: "https://chat.aomi.dev/v1/pipeline/mcp",
      requiredScopes: ["mcp:pipeline"],
      challengeScopes: ["mcp:pipeline", "pipeline:catalog", "offline_access"],
      dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
    });
    for (const method of ["initialize", "tools/list", "tools/call"]) {
      const response = await POST(
        new Request("https://chat.aomi.dev/v1/pipeline/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        }),
      );
      expect(response.status).toBe(401);
    }
  });

  it.each([
    "aomi_get_agent_context",
    "aomi_list_apps",
    "aomi_list_namespaces",
    "aomi_list_tools",
  ])("delegates %s to Rust without a Portal tool classifier", async (name) => {
    const request = new Request("https://chat.aomi.dev/v1/pipeline/mcp", {
      method: "POST",
      headers: { authorization: "Bearer exact-resource-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {} },
      }),
    });

    expect((await POST(request)).status).toBe(200);
    expect(mocks.principal).toHaveBeenCalledWith(
      { sub: "user-1" },
      "https://chat.aomi.dev/v1/pipeline/mcp",
    );
    const [proxied, delegated] = mocks.proxy.mock.calls.at(-1) as [
      Request,
      typeof principal,
    ];
    expect(new URL(proxied.url).pathname).toBe("/v1/pipeline/mcp");
    expect(await proxied.text()).toContain(name);
    expect(delegated).toMatchObject({ scopes: principal.scopes });
  });
});
