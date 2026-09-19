import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  readClient: vi.fn(),
  requirePrincipal: vi.fn(),
}));

vi.mock("@aomi-labs/account/widget-auth", () => ({
  issueWidgetOAuthBootstrapTicket: mocks.issue,
  requireWidgetOrigin: (request: Request) => request.headers.get("origin"),
  sha256Hex: (value: string) => `sha256:${value}`,
  widgetSessionIdentifierForRequest: () => "widget-session-identifier",
  WidgetAuthError: class WidgetAuthError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
    }
  },
}));
vi.mock("@aomi-labs/account/better-auth", () => ({
  readManagedOAuthClient: mocks.readClient,
  aomiOAuthResourcePolicy: (resource: string) =>
    resource === "https://portal.example/v1/agent"
      ? {
          kind: "agentRest",
          identifier: resource,
          allowedScopes: ["agent:read", "agent:write"],
        }
      : null,
  validateAomiResourceScopes: (_resource: string, scopes: string[]) => ({
    ok: scopes.every((scope) => ["agent:read", "agent:write"].includes(scope)),
  }),
}));
vi.mock("@portal/server/widget-auth/principal", () => ({
  requirePortalPrincipal: mocks.requirePrincipal,
}));
vi.mock("@portal/server/widget-auth/rate-limit", () => ({
  widgetAuthRateLimit: () => null,
}));
vi.mock("@portal/server/widget-auth/response", () => ({
  widgetRoute: (handler: (request: Request) => Promise<Response>) => handler,
  widgetPreflight: () => () => new Response(null, { status: 204 }),
}));

import { POST } from "./route";

const origin = "https://partner.example";
const validClient = {
  clientId: "widget-client",
  clientClass: "partner_widget",
  disabled: false,
  dpopBoundAccessTokens: true,
  origins: [origin],
  redirectUris: [`${origin}/oauth/callback`],
  resources: ["https://portal.example/v1/agent"],
  scopes: ["agent:read", "agent:write"],
};

beforeEach(() => {
  mocks.issue
    .mockReset()
    .mockResolvedValue({ ticket: "opaque", expiresAt: 10 });
  mocks.readClient.mockReset().mockResolvedValue(validClient);
  mocks.requirePrincipal.mockReset().mockResolvedValue({
    kind: "widget",
    origin,
    userId: "user-1",
    authMethod: "siwe",
  });
});

describe("widget OAuth bootstrap issuance", () => {
  it("binds the live WST to exact managed client policy", async () => {
    const response = await POST(request({ scope: "agent:read" }));
    expect(response.status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        origin,
        userId: "user-1",
        widgetSessionIdentifier: "widget-session-identifier",
        clientId: "widget-client",
        resource: "https://portal.example/v1/agent",
        scopes: ["agent:read"],
        stateDigest: "sha256:state-state-state",
        channelNonceDigest: "sha256:channel-channel-channel",
      }),
    );
  });

  it("rejects origin/client mismatches and cross-resource scope escalation", async () => {
    mocks.readClient.mockResolvedValueOnce({
      ...validClient,
      origins: ["https://different.example"],
    });
    await expect(POST(request({ scope: "agent:read" }))).rejects.toMatchObject({
      code: "invalid_oauth_client",
      status: 403,
    });
    await expect(
      POST(request({ scope: "pipeline:execute" })),
    ).rejects.toMatchObject({ code: "invalid_oauth_scope", status: 400 });
  });
});

function request(overrides: { scope: string }) {
  return new Request("https://portal.example/api/auth/widget/oauth-bootstrap", {
    method: "POST",
    headers: { origin, authorization: "Bearer aomi_wst_test" },
    body: JSON.stringify({
      client_id: "widget-client",
      redirect_uri: `${origin}/oauth/callback`,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: "https://portal.example/v1/agent",
      scope: overrides.scope,
      state: "state-state-state",
      channel_nonce: "channel-channel-channel",
    }),
  });
}
