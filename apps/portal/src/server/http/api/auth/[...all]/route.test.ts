// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  handler: vi.fn(),
  oauthRedirectFailureDiagnostics: vi.fn(),
  guestScopes: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  auth: {
    api: { getSession: mocks.getSession },
    handler: mocks.handler,
  },
  aomiOAuthResources: () => ({
    portalOrigin: "https://portal.example",
  }),
  guestScopesForAomiResource: (_resource: string, scopes: string[]) => scopes,
  BETTER_AUTH_OAUTH_PROVIDER_VERSION: "1.7.1",
  hashOAuthClientId: () => "hashed-client",
  oauthRedirectFailureDiagnostics: mocks.oauthRedirectFailureDiagnostics,
}));
vi.mock("@/server/oauth/cors", () => ({
  applyManagedWidgetCors: vi.fn(),
  isManagedWidgetClientOrigin: vi.fn(),
  managedWidgetPreflight: vi.fn(),
  oauthBodyClientId: vi.fn(),
  publicDiscoveryResponse: vi.fn(),
}));
vi.mock("@/server/oauth/request-policy", () => ({
  // The policy hands the (possibly scope-narrowed) request back to the route,
  // so the mock has to return one rather than a bare pass signal. A plain
  // function, not vi.fn(), so the global mock reset cannot strip it.
  enforceAomiOAuthRequestPolicy: async (request: Request) => ({
    kind: "continue" as const,
    request,
  }),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.handler.mockReset().mockResolvedValue(Response.json({ ok: true }));
  mocks.oauthRedirectFailureDiagnostics.mockReset();
  mocks.guestScopes
    .mockReset()
    .mockImplementation((_resource: string, scopes: string[]) => scopes);
});

describe("OAuth redirect rejection diagnostics", () => {
  it("logs only safe diagnostics after Better Auth rejects a redirect", async () => {
    const diagnostics = {
      clientIdHash: "hashed-client",
      clientFound: true,
      registeredRedirectCount: 1,
      registeredStorageShape: "json_array",
      requestedUrlValid: true,
      credentialsAbsent: true,
      fragmentAbsent: true,
      exactMatch: false,
      loopbackMatch: false,
      protocolMatch: true,
      hostnameMatch: true,
      portMatch: false,
      pathMatch: false,
      queryMatch: true,
    };
    mocks.oauthRedirectFailureDiagnostics.mockResolvedValue(diagnostics);
    mocks.handler.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location:
            "https://portal.example/error?error=invalid_redirect&error_description=invalid",
        },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(
      new Request(
        "https://portal.example/api/auth/oauth2/authorize?" +
          new URLSearchParams({
            client_id: "private-client",
            redirect_uri: "http://user@127.0.0.1:52100/callback#private",
            response_type: "code",
            scope: "openid",
          }),
      ),
    );

    expect(mocks.oauthRedirectFailureDiagnostics).toHaveBeenCalledWith(
      "private-client",
      "http://user@127.0.0.1:52100/callback#private",
    );
    expect(warn).toHaveBeenCalledWith(
      "better_auth_oauth_redirect_rejected",
      expect.objectContaining({
        ...diagnostics,
        betterAuthVersion: "1.7.1",
        diagnosticsAvailable: true,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-client");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("callback");
  });

  it("does not query or log redirect diagnostics for successful authorization", async () => {
    mocks.handler.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://portal.example/oauth/authorize" },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(
      new Request(
        "https://portal.example/api/auth/oauth2/authorize?client_id=client",
      ),
    );

    expect(mocks.oauthRedirectFailureDiagnostics).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("observes Better Auth JSON redirects returned by hosted requests", async () => {
    mocks.oauthRedirectFailureDiagnostics.mockResolvedValue({
      clientIdHash: "hashed-client",
    });
    mocks.handler.mockResolvedValue(
      Response.json({
        redirect: true,
        url: "https://portal.example/error?error=invalid_redirect",
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(
      new Request(
        "https://portal.example/api/auth/oauth2/authorize?" +
          new URLSearchParams({
            client_id: "private-client",
            redirect_uri: "http://127.0.0.1:52100/callback",
          }),
      ),
    );

    expect(mocks.oauthRedirectFailureDiagnostics).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "better_auth_oauth_redirect_rejected",
      expect.objectContaining({ diagnosticsAvailable: true }),
    );
  });
});

describe("anonymous sign-in", () => {
  it("cannot replace an existing signed-in session", async () => {
    mocks.getSession.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1", isAnonymous: false },
    });

    const response = await POST(
      new Request("https://portal.example/api/auth/sign-in/anonymous", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "session_exists",
    });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("creates an anonymous session only when no session exists", async () => {
    mocks.getSession.mockResolvedValue(null);
    const request = new Request(
      "https://portal.example/api/auth/sign-in/anonymous",
      { method: "POST" },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledWith(request);
  });
});

describe("guest consent", () => {
  it.each(["native", "server adapter"])(
    "bounds consent scopes without losing credentials or cancellation for a %s request",
    async (kind) => {
      mocks.getSession.mockResolvedValue({ user: { isAnonymous: true } });
      mocks.guestScopes.mockReturnValue(["agent:read"]);
      const controller = new AbortController();
      const consent = {
        scope: "agent:read agent:write",
        oauth_query: new URLSearchParams({
          resource: "https://portal.example/v1/agent",
          client_id: "guest-client",
        }).toString(),
        accept: true,
      };
      const source = new Request(
        "https://portal.example/api/auth/oauth2/consent",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://portal.example",
            cookie: "session=guest",
          },
          body: JSON.stringify(consent),
          signal: controller.signal,
        },
      );
      const request: Request =
        kind === "native"
          ? source
          : Object.create(Request.prototype, {
              url: { value: source.url },
              method: { value: source.method },
              headers: { value: source.headers },
              signal: { value: source.signal },
              clone: { value: () => source.clone() },
            });
      const response = new Response("consented", {
        headers: { "set-cookie": "session=guest; HttpOnly" },
      });
      mocks.handler.mockResolvedValue(response);

      expect(await POST(request)).toBe(response);
      expect(mocks.guestScopes).toHaveBeenCalledWith(
        "https://portal.example/v1/agent",
        ["agent:read", "agent:write"],
      );
      const forwarded = mocks.handler.mock.calls[0]![0] as Request;
      expect(forwarded).toBeInstanceOf(Request);
      expect(forwarded.url).toBe(source.url);
      expect(forwarded.method).toBe("POST");
      expect([...forwarded.headers]).toEqual([...source.headers]);
      await expect(forwarded.json()).resolves.toEqual({
        ...consent,
        scope: "agent:read",
      });
      await expect(source.clone().json()).resolves.toEqual(consent);
      controller.abort("client disconnected");
      expect(forwarded.signal.aborted).toBe(true);
      expect(forwarded.signal.reason).toBe("client disconnected");
    },
  );
});

vi.mock("@aomi-labs/account/better-auth/core", () => ({
  auth: {
    api: { getSession: mocks.getSession },
    handler: mocks.handler,
  },
  aomiOAuthResources: () => ({
    portalOrigin: "https://portal.example",
  }),
  guestScopesForAomiResource: mocks.guestScopes,
  BETTER_AUTH_OAUTH_PROVIDER_VERSION: "1.7.1",
  hashOAuthClientId: () => "hashed-client",
  oauthRedirectFailureDiagnostics: mocks.oauthRedirectFailureDiagnostics,
}));
