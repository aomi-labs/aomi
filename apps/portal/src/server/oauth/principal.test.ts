import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessTokenRequest: vi.fn(),
  hasWidgetSessionBearer: vi.fn(),
  resolveWidgetSession: vi.fn(),
  getBetterAuthSession: vi.fn(),
  canonicalAccount: vi.fn(),
  dpopRequired: false,
  e2eCanonicalUserId: vi.fn(),
}));

vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: {},
  AOMI_CANONICAL_USER_CLAIM: "https://aomi.dev/canonical_user_id",
  AOMI_PRINCIPAL_CLASS_CLAIM: "https://aomi.dev/principal_class",
}));
vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({
      verifyAccessTokenRequest: mocks.verifyAccessTokenRequest,
    }),
  }),
}));
vi.mock("@aomi-labs/account/account", () => ({
  getOrCreateAomiUserForBetterAuthSession: mocks.canonicalAccount,
}));
vi.mock("@aomi-labs/account/widget-auth", () => ({
  hasWidgetSessionBearer: mocks.hasWidgetSessionBearer,
  resolveWidgetSession: mocks.resolveWidgetSession,
}));
vi.mock("@portal/server/account/session", () => ({
  getBetterAuthSession: mocks.getBetterAuthSession,
}));
vi.mock("@portal/server/e2e-wallet", () => ({
  resolveE2ECanonicalUserId: mocks.e2eCanonicalUserId,
}));
vi.mock("./features", () => ({
  isGuestRestEnabled: () => true,
}));
vi.mock("./resources", () => ({
  aomiOAuthResources: () => ({
    portalOrigin: "https://portal.example",
    authorizationServerIssuer: "https://portal.example/api/auth",
  }),
  aomiOAuthResourcePolicy: () => ({
    dpopBoundAccessTokensRequired: mocks.dpopRequired,
  }),
  guestScopesForAomiResource: (_resource: string, scopes: string[]) =>
    scopes.filter((scope) =>
      [
        "agent:read",
        "agent:write",
        "agent:actions:resolve",
        "offline_access",
      ].includes(scope),
    ),
}));

import {
  ApiPrincipalError,
  isOAuthCredential,
  principalFromOAuthClaims,
  resolveApiPrincipal,
} from "./principal";

const resource = "https://portal.example/v1/agent" as const;
const claims = {
  iss: "https://portal.example/api/auth",
  aud: resource,
  sub: "ba-user",
  scope: "agent:read agent:write",
  client_id: "client-1",
  jti: "grant-1",
  "https://aomi.dev/canonical_user_id": "canonical-user",
  "https://aomi.dev/principal_class": "user",
};

describe("public OAuth and session principal resolution", () => {
  beforeEach(() => {
    mocks.verifyAccessTokenRequest.mockReset();
    mocks.hasWidgetSessionBearer
      .mockReset()
      .mockImplementation(
        (request: Request) =>
          request.headers
            .get("authorization")
            ?.startsWith("Bearer aomi_wst_") === true,
      );
    mocks.resolveWidgetSession.mockReset().mockResolvedValue(null);
    mocks.getBetterAuthSession.mockReset().mockResolvedValue(null);
    mocks.e2eCanonicalUserId.mockReset().mockReturnValue(null);
    mocks.canonicalAccount
      .mockReset()
      .mockResolvedValue({ id: "canonical-user" });
    mocks.dpopRequired = false;
  });

  it("classifies JWT Bearer and DPoP credentials without confusing session bearers", () => {
    expect(
      isOAuthCredential(
        new Request(resource, {
          headers: { authorization: "Bearer one.two.three" },
        }),
      ),
    ).toBe(true);
    expect(
      isOAuthCredential(
        new Request(resource, { headers: { authorization: "DPoP token" } }),
      ),
    ).toBe(true);
    expect(
      isOAuthCredential(
        new Request(resource, {
          headers: { authorization: "Bearer opaque-session" },
        }),
      ),
    ).toBe(false);
  });

  it("passes exact audience, scope, and DPoP policy to Better Auth", async () => {
    mocks.verifyAccessTokenRequest.mockResolvedValue(claims);
    const request = new Request(resource, {
      headers: { authorization: "Bearer one.two.three" },
    });
    await expect(
      resolveApiPrincipal({
        request,
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).resolves.toMatchObject({
      canonicalUserId: "canonical-user",
      clientId: "client-1",
      authSource: "oauth",
    });
    expect(mocks.verifyAccessTokenRequest).toHaveBeenCalledWith(request, {
      jwksUrl: "https://portal.example/api/auth/jwks",
      verifyOptions: {
        audience: resource,
        issuer: "https://portal.example/api/auth",
      },
      requiredScopes: ["agent:read"],
      dpop: { signingAlgorithms: ["ES256", "EdDSA"] },
    });
  });

  it("uses an origin-bound widget session directly for bounded REST access", async () => {
    mocks.resolveWidgetSession.mockResolvedValue({
      userId: "canonical-user",
      origin: "https://partner.example",
      authMethod: "siwe",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const request = new Request(resource, {
      method: "POST",
      headers: {
        authorization: "Bearer aomi_wst_widget",
        origin: "https://partner.example",
      },
    });

    await expect(
      resolveApiPrincipal({
        request,
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: [
          "agent:read",
          "agent:write",
          "agent:actions:resolve",
          "custody:delegate",
        ],
      }),
    ).resolves.toEqual({
      canonicalUserId: "canonical-user",
      scopes: ["agent:write", "agent:actions:resolve"],
      resource,
      authSource: "session",
      principalClass: "user",
      sid: "widget-session",
      widgetOrigin: "https://partner.example",
    });
    expect(mocks.verifyAccessTokenRequest).not.toHaveBeenCalled();
    expect(mocks.getBetterAuthSession).not.toHaveBeenCalled();
  });

  it("lets anonymous widgets resolve their own actions within the guest ceiling", async () => {
    mocks.resolveWidgetSession.mockResolvedValue({
      userId: "canonical-guest",
      origin: "https://partner.example",
      authMethod: "anonymous",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: {
            authorization: "Bearer aomi_wst_guest",
            origin: "https://partner.example",
          },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:read", "agent:write", "agent:actions:resolve"],
      }),
    ).resolves.toMatchObject({
      canonicalUserId: "canonical-guest",
      scopes: ["agent:write", "agent:actions:resolve"],
      principalClass: "guest",
    });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: {
            authorization: "Bearer aomi_wst_guest",
            origin: "https://partner.example",
          },
        }),
        resource,
        requiredScopes: ["agent:actions:resolve"],
        sessionScopes: ["agent:read", "agent:write", "agent:actions:resolve"],
      }),
    ).resolves.toMatchObject({
      canonicalUserId: "canonical-guest",
      scopes: ["agent:actions:resolve"],
      principalClass: "guest",
    });
  });

  it.each(["siwe", "siws"])(
    "allows authenticated %s widget sessions to resolve actions",
    async (authMethod) => {
      mocks.resolveWidgetSession.mockResolvedValue({
        userId: "canonical-user",
        origin: "https://partner.example",
        authMethod,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      });

      await expect(
        resolveApiPrincipal({
          request: new Request(resource, {
            method: "POST",
            headers: {
              authorization: "Bearer aomi_wst_authenticated",
              origin: "https://partner.example",
            },
          }),
          resource,
          requiredScopes: ["agent:actions:resolve"],
          sessionScopes: ["agent:actions:resolve"],
        }),
      ).resolves.toMatchObject({
        scopes: ["agent:actions:resolve"],
        principalClass: "user",
      });
    },
  );

  it("rejects a revoked widget session without cookie fallback", async () => {
    mocks.getBetterAuthSession.mockResolvedValue({
      user: { id: "cookie-user" },
    });
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: {
            authorization: "Bearer aomi_wst_revoked",
            origin: "https://partner.example",
          },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(mocks.getBetterAuthSession).not.toHaveBeenCalled();
  });

  it("never falls back to a cookie session after invalid OAuth", async () => {
    mocks.verifyAccessTokenRequest.mockRejectedValue({ status: 401 });
    mocks.getBetterAuthSession.mockResolvedValue({
      user: { id: "cookie-user" },
    });
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: { authorization: "Bearer invalid.jwt.value" },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(mocks.getBetterAuthSession).not.toHaveBeenCalled();
  });

  it("resolves opaque bearer session tokens through Better Auth, rejecting unknowns", async () => {
    // The guest/SDK flow carries the Better Auth session token as a Bearer
    // (no cookie cross-origin); the bearer plugin resolves it via getSession.
    mocks.getBetterAuthSession.mockResolvedValueOnce({
      user: { id: "ba-guest", isAnonymous: true },
      session: {},
    });
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: { authorization: "Bearer opaque-session" },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).resolves.toMatchObject({ principalClass: "guest" });

    // A bearer no session resolves to is still rejected.
    mocks.getBetterAuthSession.mockResolvedValueOnce(null);
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: { authorization: "Bearer unknown-token" },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  });

  it("rejects canonical identity disagreement and elevated guest scopes", async () => {
    mocks.canonicalAccount.mockResolvedValueOnce({ id: "different-user" });
    await expect(
      principalFromOAuthClaims(claims, resource),
    ).rejects.toBeInstanceOf(ApiPrincipalError);

    mocks.canonicalAccount.mockResolvedValueOnce({ id: "canonical-user" });
    await expect(
      principalFromOAuthClaims(
        {
          ...claims,
          scope: "agent:read custody:delegate",
          "https://aomi.dev/principal_class": "guest",
        },
        resource,
      ),
    ).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });
  });

  it("pins issuer and one string audience and enforces the MCP DPoP switch", async () => {
    await expect(
      principalFromOAuthClaims(
        { ...claims, iss: "https://evil.example" },
        resource,
      ),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(
      principalFromOAuthClaims({ ...claims, aud: [resource] }, resource),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });

    mocks.dpopRequired = true;
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: { authorization: "Bearer one.two.three" },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    expect(mocks.verifyAccessTokenRequest).not.toHaveBeenCalled();

    mocks.verifyAccessTokenRequest.mockResolvedValue(claims);
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          headers: {
            authorization: "DPoP one.two.three",
            dpop: "proof",
          },
        }),
        resource,
        requiredScopes: ["agent:read"],
        sessionScopes: ["agent:read"],
      }),
    ).resolves.toMatchObject({ authSource: "oauth" });
  });

  it("requires same-origin CSRF for mutating cookie sessions", async () => {
    mocks.getBetterAuthSession.mockResolvedValue({
      user: {
        id: "ba-user",
        email: "user@example.com",
        emailVerified: true,
        name: "Aomi User",
        image: null,
        isAnonymous: false,
      },
      session: { token: "secret" },
    });
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, { method: "POST" }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).rejects.toMatchObject({ code: "csrf_failed", status: 403 });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: { origin: "https://portal.example" },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).resolves.toMatchObject({ authSource: "session" });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).resolves.toMatchObject({ authSource: "session" });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: { "x-aomi-csrf": "1" },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).resolves.toMatchObject({ authSource: "session" });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site" },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).rejects.toMatchObject({ code: "csrf_failed", status: 403 });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: {
            "sec-fetch-site": "cross-site",
            "x-aomi-csrf": "1",
          },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).rejects.toMatchObject({ code: "csrf_failed", status: 403 });

    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "sec-fetch-site": "same-origin",
          },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:write"],
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  });
  it("resolves the signed local E2E session at the principal boundary", async () => {
    mocks.e2eCanonicalUserId.mockReturnValue("e2e-user");
    await expect(
      resolveApiPrincipal({
        request: new Request(resource, {
          method: "POST",
          headers: { origin: "https://portal.example" },
        }),
        resource,
        requiredScopes: ["agent:write"],
        sessionScopes: ["agent:read", "agent:write"],
      }),
    ).resolves.toEqual({
      canonicalUserId: "e2e-user",
      scopes: ["agent:read", "agent:write"],
      resource,
      authSource: "session",
      principalClass: "user",
      sid: "e2e-session",
    });
    expect(mocks.getBetterAuthSession).not.toHaveBeenCalled();
  });
});
