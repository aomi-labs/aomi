// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PORTAL = "https://portal.example";
const PARTNER = "https://partner.example";

const mocks = vi.hoisted(() => ({
  mintAccountBearer: vi.fn(),
  mintAgentApiBearer: vi.fn(),
  fetch: vi.fn(),
  managedClient: vi.fn(),
  e2eAccountId: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
  listConnections: vi.fn(),
  revokeConnection: vi.fn(),
  consume: vi.fn(async () => ({ allowed: true, retryAfter: null })),
}));

// One table of credentials stands in for Better Auth, widget sessions and the
// OAuth resource server; everything above them (resolver, capabilities,
// forwarding, error mapping, CORS) is the real pipeline.
const SESSIONS: Record<
  string,
  { user: { id: string; isAnonymous: boolean }; session: { token: string } }
> = {
  user: {
    user: { id: "user", isAnonymous: false },
    session: { token: "tok-user" },
  },
  guest: {
    user: { id: "guest", isAnonymous: true },
    session: { token: "tok-guest" },
  },
  "cli-token": {
    user: { id: "user", isAnonymous: false },
    session: { token: "cli-token" },
  },
};
const WIDGETS: Record<
  string,
  { userId: string; origin: string; authMethod: string }
> = {
  aomi_wst_user: { userId: "acct-widget", origin: PARTNER, authMethod: "siwe" },
  aomi_wst_guest: {
    userId: "acct-widget-guest",
    origin: PARTNER,
    authMethod: "anonymous",
  },
};
const TOKENS: Record<
  string,
  { sub: string; class: "user" | "guest"; scope: string; aud: string }
> = {
  // An old grant: custody:delegate is no longer granted, and never minted.
  "oauth.user.jwt": {
    sub: "user",
    class: "user",
    scope: "agent:read agent:write agent:actions:resolve custody:delegate",
    aud: `${PORTAL}/v1/agent`,
  },
  "oauth.guest.jwt": {
    sub: "guest",
    class: "guest",
    scope: "agent:read agent:write",
    aud: `${PORTAL}/v1/agent`,
  },
  "mcp.user.jwt": {
    sub: "user",
    class: "user",
    scope: "mcp:agent agent:read agent:write",
    aud: `${PORTAL}/v1/agent/mcp`,
  },
  // The CLI / SDK sign-in: one `/v1` token carrying every REST scope.
  "api.user.jwt": {
    sub: "user",
    class: "user",
    scope:
      "agent:read agent:write pipeline:catalog account:apps:read account:credentials:write",
    aud: `${PORTAL}/v1`,
  },
};

function claimsFor(token: string) {
  const entry = TOKENS[token];
  if (!entry) return null;
  return {
    sub: entry.sub,
    iss: `${PORTAL}/api/auth`,
    aud: entry.aud,
    scope: entry.scope,
    client_id: "client-1",
    jti: "grant-1",
    "https://aomi.dev/canonical_user_id": `acct-${entry.sub}`,
    "https://aomi.dev/principal_class": entry.class,
  };
}

function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.split(/\s+/)[1];
}

vi.mock("@aomi-labs/account/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/rate-limit")>()),
  accountRateLimitStorage: { consume: mocks.consume },
}));
vi.mock("@aomi-labs/account", () => ({
  mintAccountBearer: mocks.mintAccountBearer,
  mintAgentApiBearer: mocks.mintAgentApiBearer,
}));
vi.mock("@aomi-labs/account/account", () => ({
  getOrCreateAomiUserForBetterAuthSession: async ({
    betterAuthUserId,
  }: {
    betterAuthUserId: string;
  }) => ({
    id: `acct-${betterAuthUserId}`,
  }),
  getAccountResponseForBetterAuthSession: async () => ({
    user: { id: "acct-user" },
  }),
  getAccountResponseForWidgetSession: async ({
    userId,
  }: {
    userId: string;
  }) => ({ user: { id: userId } }),
  updateAccountProfile: vi.fn(),
  listAccountConnections: mocks.listConnections,
  revokeOAuthConnection: mocks.revokeConnection,
  IdentityConflictError: class IdentityConflictError extends Error {},
}));
vi.mock("@aomi-labs/account/better-auth", async () => ({
  ...(await import("@aomi-labs/account/better-auth/oauth-policy")),
  ...(await import("@aomi-labs/account/better-auth/env")),
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createSession: mocks.createSession,
        deleteSession: mocks.deleteSession,
      },
    }),
  },
  readManagedOAuthClient: async (clientId: string) =>
    mocks.managedClient(clientId),
  listManagedWidgetOrigins: async () => ["https://managed.example"],
}));
vi.mock("@/server/account/session", () => ({
  getBetterAuthSession: async (request: Request) => {
    const token = bearerToken(request);
    if (request.headers.has("authorization"))
      return SESSIONS[token ?? ""] ?? null;
    const cookie = /session=(\w+)/.exec(
      request.headers.get("cookie") ?? "",
    )?.[1];
    return cookie ? (SESSIONS[cookie] ?? null) : null;
  },
  sessionUserSeed: (session: { user?: { id: string } } | null) =>
    session?.user ? { betterAuthUserId: session.user.id } : null,
}));
vi.mock("@aomi-labs/account/widget-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aomi-labs/account/widget-auth")>();
  return {
    ...actual,
    resolveWidgetSession: async ({ request }: { request: Request }) => {
      const ticket = WIDGETS[bearerToken(request) ?? ""];
      const origin = actual.observedWidgetOrigin(request);
      return ticket && ticket.origin === origin
        ? { ...ticket, expiresAt: 1 }
        : null;
    },
  };
});
vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({
      verifyAccessTokenRequest: async (
        request: Request,
        options: {
          verifyOptions: { audience: string | string[] };
          requiredScopes: string[];
        },
      ) => {
        const claims = claimsFor(bearerToken(request) ?? "");
        // As jose: the token's audience must be one of those accepted.
        // Failures are Better Auth APIErrors: a status name and statusCode.
        if (
          !claims ||
          ![options.verifyOptions.audience].flat().includes(claims.aud)
        )
          throw Object.assign(new Error("token expired"), {
            status: "UNAUTHORIZED",
            statusCode: 401,
          });
        const granted = claims.scope.split(" ");
        if (options.requiredScopes.some((scope) => !granted.includes(scope)))
          throw Object.assign(new Error("scope"), {
            status: "FORBIDDEN",
            statusCode: 403,
          });
        return claims;
      },
    }),
  }),
}));
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth:
    (
      _auth: unknown,
      handler: (request: Request, claims: unknown) => Promise<Response>,
      options: { resource: string },
    ) =>
    async (request: Request) => {
      const claims = claimsFor(bearerToken(request) ?? "");
      return claims && claims.aud === options.resource
        ? handler(request, claims)
        : new Response(null, {
            status: 401,
            headers: { "www-authenticate": "Bearer" },
          });
    },
}));
vi.mock("@/server/bff/dev/e2e-wallet", () => ({
  e2eAccountId: mocks.e2eAccountId,
}));
vi.mock("@/server/bff/failures", () => ({
  portalFailures: {
    handle: (input: { response?: { status: number; error: string } }) => ({
      response: Response.json(
        { error: input.response?.error ?? "internal_error" },
        { status: input.response?.status ?? 500 },
      ),
    }),
  },
}));

import { NextRequest } from "next/server";
import { routes } from "./routes";

type Family = {
  call: () => Promise<Response>;
  method: string;
  url: string;
};

function request(path: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`${PORTAL}${path}`, { ...init, headers });
}

type Credential = {
  headers: Record<string, string>;
  origin?: string;
  vercel?: boolean;
};

const CREDENTIALS: Record<string, Credential> = {
  "cookie user": { headers: { cookie: "session=user" }, origin: PORTAL },
  "cookie guest": { headers: { cookie: "session=guest" }, origin: PORTAL },
  "session bearer": { headers: { authorization: "Bearer cli-token" } },
  "widget user": {
    headers: { authorization: "Bearer aomi_wst_user" },
    origin: PARTNER,
  },
  "widget guest": {
    headers: { authorization: "Bearer aomi_wst_guest" },
    origin: PARTNER,
  },
  "widget, wrong origin": {
    headers: { authorization: "Bearer aomi_wst_user" },
    origin: "https://other.example",
  },
  "invalid widget session": {
    headers: { authorization: "Bearer aomi_wst_revoked" },
    origin: PARTNER,
  },
  "OAuth user": { headers: { authorization: "Bearer oauth.user.jwt" } },
  "OAuth user, DPoP": {
    headers: { authorization: "DPoP oauth.user.jwt", dpop: "proof" },
  },
  "OAuth guest": { headers: { authorization: "Bearer oauth.guest.jwt" } },
  none: { headers: {}, origin: PORTAL },
  "e2e cookie": { headers: { cookie: "aomi_e2e_wallet=seed" }, origin: PORTAL },
  "e2e cookie on Vercel": {
    headers: { cookie: "aomi_e2e_wallet=seed" },
    origin: PORTAL,
    vercel: true,
  },
};

const FAMILIES = {
  "/api chat": ["POST", "/api/thread/model", routes.backend.POST],
  "/api settings": ["GET", "/api/secrets", routes.backend.GET],
  "/api commit": ["GET", "/api/commits/0b9c1f2e", routes.backend.GET],
  "/v1/agent": ["POST", "/v1/agent/sessions", routes.agent.POST],
  "/v1/account/credits": ["GET", "/v1/account/credits", routes.credits.GET],
  "/v1/account": ["GET", "/v1/account", routes.account.GET],
  "/v1/account/bearer": ["GET", "/v1/account/bearer", routes.bearer.GET],
  "/v1/account/session/cli": [
    "POST",
    "/v1/account/session/cli",
    routes.cliSession.POST,
  ],
  "/v1/agent/mcp": ["POST", "/v1/agent/mcp", routes.agentMcp.POST],
} as const;
type FamilyName = keyof typeof FAMILIES;

// Minted: the account bearer subject for /api, or [subject, class, scope] for the agent API.
type Outcome = number | [200, string] | [200, string, "user" | "guest", string];
const user = "acct-user";
const MATRIX: Record<string, Record<FamilyName, Outcome>> = {
  "cookie user": {
    "/api chat": [200, user],
    "/api settings": [200, user],
    "/api commit": [200, user],
    "/v1/agent": [200, user, "user", "agent:write"],
    "/v1/account/credits": [200, user, "user", "account:credits:read"],
    "/v1/account": 200,
    "/v1/account/bearer": [200, user],
    "/v1/account/session/cli": 403,
    "/v1/agent/mcp": 401,
  },
  "cookie guest": {
    "/api chat": [200, "acct-guest"],
    "/api settings": 403,
    "/api commit": [200, "acct-guest"],
    "/v1/agent": [200, "acct-guest", "guest", "agent:write"],
    "/v1/account/credits": 403,
    "/v1/account": 200,
    "/v1/account/bearer": [200, "acct-guest"],
    "/v1/account/session/cli": 403,
    "/v1/agent/mcp": 401,
  },
  "session bearer": {
    "/api chat": [200, user],
    "/api settings": [200, user],
    "/api commit": [200, user],
    "/v1/agent": [200, user, "user", "agent:write"],
    "/v1/account/credits": [200, user, "user", "account:credits:read"],
    "/v1/account": 200,
    "/v1/account/bearer": [200, user],
    "/v1/account/session/cli": 200,
    "/v1/agent/mcp": 401,
  },
  "widget user": {
    "/api chat": [200, "acct-widget"],
    "/api settings": [200, "acct-widget"],
    "/api commit": [200, "acct-widget"],
    "/v1/agent": [200, "acct-widget", "user", "agent:write"],
    "/v1/account/credits": [200, "acct-widget", "user", "account:credits:read"],
    "/v1/account": 200,
    "/v1/account/bearer": 403,
    "/v1/account/session/cli": 403,
    "/v1/agent/mcp": 401,
  },
  "widget guest": {
    "/api chat": [200, "acct-widget-guest"],
    "/api settings": 403,
    "/api commit": [200, "acct-widget-guest"],
    "/v1/agent": [200, "acct-widget-guest", "guest", "agent:write"],
    "/v1/account/credits": 403,
    "/v1/account": 200,
    "/v1/account/bearer": 403,
    "/v1/account/session/cli": 403,
    "/v1/agent/mcp": 401,
  },
  "widget, wrong origin": allStatus(401),
  "invalid widget session": allStatus(401),
  "OAuth user": {
    ...allStatus(401),
    "/api commit": [200, user],
    "/v1/agent": [200, user, "user", "agent:write"],
  },
  "OAuth user, DPoP": {
    ...allStatus(401),
    "/api commit": [200, user],
    "/v1/agent": [200, user, "user", "agent:write"],
  },
  "OAuth guest": {
    ...allStatus(401),
    "/api commit": [200, "acct-guest"],
    "/v1/agent": [200, "acct-guest", "guest", "agent:write"],
  },
  none: {
    ...allStatus(401),
    "/api chat": 200,
    "/v1/account": 200,
  },
  "e2e cookie": {
    "/api chat": [200, "acct-e2e"],
    "/api settings": [200, "acct-e2e"],
    "/api commit": [200, "acct-e2e"],
    "/v1/agent": [200, "acct-e2e", "user", "agent:write"],
    "/v1/account/credits": [200, "acct-e2e", "user", "account:credits:read"],
    // The E2E stand-in never served the portal's own account routes.
    "/v1/account": 200,
    "/v1/account/bearer": [200, "acct-e2e"],
    "/v1/account/session/cli": 401,
    "/v1/agent/mcp": 401,
  },
  "e2e cookie on Vercel": {
    ...allStatus(401),
    "/api chat": 200,
    "/v1/account": 200,
  },
};

function allStatus(status: number): Record<FamilyName, Outcome> {
  return Object.fromEntries(
    Object.keys(FAMILIES).map((family) => [family, status]),
  ) as Record<FamilyName, Outcome>;
}

function upstreamCalls() {
  return mocks.fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: new Headers((init as RequestInit).headers),
  }));
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", PORTAL);
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://backend.example");
  vi.stubEnv("AOMI_AGENT_API_URL", "https://agent.example");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch
    .mockReset()
    .mockImplementation(async () => Response.json({ ok: true }));
  mocks.mintAccountBearer
    .mockReset()
    .mockImplementation(async (accountId: string) => ({
      bearer: `account:${accountId}`,
      expiresAt: 1,
    }));
  mocks.mintAgentApiBearer
    .mockReset()
    .mockImplementation(async (accountId: string) => ({
      bearer: `agent:${accountId}`,
      expiresAt: 1,
    }));
  mocks.managedClient.mockReset().mockResolvedValue(null);
  mocks.e2eAccountId
    .mockReset()
    .mockImplementation((request: Request) =>
      request.headers.get("cookie")?.includes("aomi_e2e_wallet")
        ? "acct-e2e"
        : null,
    );
  mocks.createSession
    .mockReset()
    .mockResolvedValue({ token: "new-cli-token", expiresAt: new Date(0) });
  mocks.deleteSession.mockReset();
  mocks.listConnections.mockReset();
  mocks.revokeConnection.mockReset();
  mocks.consume
    .mockReset()
    .mockResolvedValue({ allowed: true, retryAfter: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("principal × route family", () => {
  const cases = Object.entries(MATRIX).flatMap(([credential, families]) =>
    Object.entries(families).map(([family, outcome]) => ({
      credential,
      family: family as FamilyName,
      outcome,
    })),
  );

  it.each(cases)(
    "$credential → $family",
    async ({ credential, family, outcome }) => {
      const { headers, origin, vercel } = CREDENTIALS[credential];
      if (vercel) vi.stubEnv("VERCEL", "1");
      const [method, path, handler] = FAMILIES[family];
      const response = await handler(
        request(path, { method, headers, origin }),
      );
      const [status, subject, principalClass, scope] = Array.isArray(outcome)
        ? outcome
        : [outcome];
      expect(response.status).toBe(status);
      if (status !== 200) {
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.mintAccountBearer).not.toHaveBeenCalled();
        expect(mocks.mintAgentApiBearer).not.toHaveBeenCalled();
        return;
      }
      if (principalClass) {
        expect(mocks.mintAgentApiBearer).toHaveBeenCalledWith(
          subject,
          expect.objectContaining({ principal_class: principalClass, scope }),
        );
        expect(upstreamCalls()[0].headers.get("authorization")).toBe(
          `Bearer agent:${subject}`,
        );
      } else if (subject) {
        expect(mocks.mintAccountBearer).toHaveBeenCalledWith(subject);
      } else {
        expect(mocks.mintAccountBearer).not.toHaveBeenCalled();
      }
      for (const call of upstreamCalls()) {
        expect(call.headers.has("cookie")).toBe(false);
        if (!subject) expect(call.headers.has("authorization")).toBe(false);
      }
    },
  );

  it.each([
    ["cookie user", "session"],
    ["e2e cookie", "session"],
    ["widget user", "widget"],
    ["widget guest", "widget"],
    ["session bearer", "cli_session"],
    ["OAuth user", "oauth"],
  ])(
    "names the client a %s authenticated through as %s",
    async (credential, source) => {
      const { headers, origin } = CREDENTIALS[credential];
      const response = await routes.agent.POST(
        request("/v1/agent/sessions", { method: "POST", headers, origin }),
      );
      expect(response.status).toBe(200);
      expect(mocks.mintAgentApiBearer).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ auth_source: source }),
      );
    },
  );

  it("only mints actions:resolve where the request needs it", async () => {
    await routes.agent.POST(
      request("/v1/agent/sessions/t/actions/a/result", {
        method: "POST",
        headers: { cookie: "session=user" },
        origin: PORTAL,
      }),
    );
    await routes.agent.POST(
      request("/v1/agent/sessions", {
        method: "POST",
        headers: { authorization: "Bearer aomi_wst_guest" },
        origin: PARTNER,
      }),
    );
    expect(
      mocks.mintAgentApiBearer.mock.calls.map(([, claims]) => claims.scope),
    ).toEqual(["agent:actions:resolve", "agent:write"]);
  });

  it("returns the guest projection without exposing the session token", async () => {
    const response = await routes.account.GET(
      request("/v1/account", { headers: { cookie: "session=guest" } }),
    );
    expect(await response.json()).toEqual({
      guest: true,
      user: null,
      linkedAccounts: [],
      wallets: [],
      session: { carrier: "better_auth", betterAuthUserId: "guest" },
    });
  });

  it("rotates a CLI session by revoking the one presented", async () => {
    const response = await routes.cliSession.POST(
      request("/v1/account/session/cli", {
        method: "POST",
        headers: { authorization: "Bearer cli-token" },
      }),
    );
    expect(await response.json()).toMatchObject({
      sessionToken: "new-cli-token",
    });
    expect(mocks.deleteSession).toHaveBeenCalledWith("cli-token");
  });
});

describe("CSRF on cookie-authenticated writes", () => {
  const write = (headers: Record<string, string>) =>
    routes.backend.POST(
      request("/api/thread/model", {
        method: "POST",
        headers: { cookie: "session=user", ...headers },
      }),
    );

  it.each([
    ["no Origin", {}],
    ["Origin null", { origin: "null" }],
    ["http: Origin", { origin: "http://portal.example" }],
    ["cross-site Origin", { origin: "https://hostile.example" }],
    ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
    [
      "cross-site fetch metadata with the CSRF header",
      { "sec-fetch-site": "cross-site", "x-aomi-csrf": "1" },
    ],
  ])("rejects %s with 403", async (_name, headers) => {
    const response = await write(headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "csrf_failed" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["the portal Origin", { origin: PORTAL }],
    ["same-origin fetch metadata", { "sec-fetch-site": "same-origin" }],
    ["the CSRF header", { "x-aomi-csrf": "1" }],
  ])("accepts %s", async (_name, headers) => {
    expect((await write(headers)).status).toBe(200);
  });

  it("ignores the cookie on a cross-site read", async () => {
    const response = await routes.account.GET(
      request("/v1/account", {
        headers: { cookie: "session=user" },
        origin: "https://hostile.example",
      }),
    );
    expect(await response.json()).toMatchObject({ user: null, session: null });
  });

  it("returns an RFC 6750 challenge for protected resources", async () => {
    const response = await routes.agent.POST(
      request("/v1/agent/sessions", {
        method: "POST",
        headers: { cookie: "session=user" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "csrf_failed", message: "Authorization failed" },
    });
  });
});

describe("explicit credentials never fall back to a cookie", () => {
  it.each([
    ["an unknown session bearer", "Bearer unknown"],
    ["a revoked widget session", "Bearer aomi_wst_revoked"],
    ["an invalid OAuth token", "Bearer bad.oauth.jwt"],
  ])("rejects %s", async (_name, authorization) => {
    const response = await routes.agent.POST(
      request("/v1/agent/sessions", {
        method: "POST",
        headers: { authorization, cookie: "session=user" },
        origin: PARTNER,
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://portal.example/.well-known/oauth-protected-resource/v1/agent"',
    );
  });

  it("accepts OAuth from a managed client's registered origin only", async () => {
    const call = (origin: string) =>
      routes.agent.POST(
        request("/v1/agent/sessions", {
          method: "POST",
          headers: { authorization: "Bearer oauth.user.jwt" },
          origin,
        }),
      );
    expect((await call("https://unregistered.example")).status).toBe(401);
    mocks.managedClient.mockResolvedValue({
      disabled: false,
      clientClass: "partner_widget",
      origins: ["https://managed.example"],
    });
    expect((await call("https://managed.example")).status).toBe(200);
  });
});

describe("CORS per family", () => {
  it.each([
    [
      "/api",
      () =>
        routes.backend.OPTIONS(
          request("/api/thread/model", { method: "OPTIONS", origin: PARTNER }),
        ),
      PARTNER,
    ],
    [
      "/v1/agent",
      () =>
        routes.agent.OPTIONS(
          request("/v1/agent/x", { method: "OPTIONS", origin: PARTNER }),
        ),
      PARTNER,
    ],
    [
      "widget sign-in",
      () =>
        routes.siweNonce.OPTIONS(
          request("/api/auth/widget/siwe/nonce", {
            method: "OPTIONS",
            origin: PARTNER,
          }),
        ),
      PARTNER,
    ],
    [
      "no usable origin",
      () =>
        routes.agent.OPTIONS(
          request("/v1/agent/x", {
            method: "OPTIONS",
            origin: "http://insecure.example",
          }),
        ),
      "*",
    ],
    [
      "public catalog",
      () => Promise.resolve(routes.publicCatalog.OPTIONS()),
      "*",
    ],
  ])("%s preflight", async (_name, call, allowOrigin) => {
    const response = await call();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      allowOrigin,
    );
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
  });

  it("echoes the widget origin on responses and on readable auth errors", async () => {
    const ok = await routes.agent.POST(
      request("/v1/agent/x", {
        method: "POST",
        headers: { authorization: "Bearer aomi_wst_user" },
        origin: PARTNER,
      }),
    );
    const denied = await routes.credits.GET(
      request("/v1/account/credits", {
        headers: { authorization: "Bearer aomi_wst_guest" },
        origin: PARTNER,
      }),
    );
    for (const response of [ok, denied]) {
      expect(response.headers.get("access-control-allow-origin")).toBe(PARTNER);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-expose-headers")).toContain(
        "WWW-Authenticate",
      );
    }
  });

  it("lets anyone read the public catalog, and only it carries CDN cache headers", async () => {
    mocks.fetch.mockResolvedValue(Response.json(["model-a"]));
    const response = await routes.publicCatalog.GET(
      request("/api/public/catalog/models"),
      {
        params: Promise.resolve({ kind: "models" }),
      },
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cdn-cache-control")).toContain("public");
  });

  it("leaves device login without cross-origin access", async () => {
    const response = await routes.deviceExchange.POST(
      request("/v1/account/device-auth/exchange", {
        method: "POST",
        origin: PARTNER,
        body: "{",
      }),
    );
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });
});

describe("error mapping", () => {
  it.each([
    [
      "/api",
      () =>
        routes.backend.POST(
          request("/api/thread/model", { method: "POST", origin: PORTAL }),
        ),
    ],
    [
      "/v1/agent",
      () =>
        routes.agent.POST(
          request("/v1/agent/x", {
            method: "POST",
            headers: { cookie: "session=user" },
            origin: PORTAL,
          }),
        ),
    ],
  ])(
    "%s: an unreachable upstream is a 502, never a 401",
    async (_name, call) => {
      mocks.fetch.mockRejectedValue(
        new Error("connect ECONNREFUSED 10.0.0.4:8080"),
      );
      const response = await call();
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toContain("upstream_unavailable");
      expect(text).not.toContain("ECONNREFUSED");
    },
  );

  it("passes upstream 400, 402, 409 and 429 through unchanged", async () => {
    for (const status of [400, 402, 409, 429]) {
      mocks.fetch.mockResolvedValueOnce(
        Response.json({ error: `upstream_${status}` }, { status }),
      );
      const response = await routes.agent.POST(
        request("/v1/agent/x", {
          method: "POST",
          headers: { cookie: "session=user" },
          origin: PORTAL,
        }),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: `upstream_${status}` });
    }
  });

  it("reports a failed bearer signature as a 502 without its message", async () => {
    mocks.mintAgentApiBearer.mockRejectedValue(new Error("PEM key missing"));
    const response = await routes.agent.GET(
      request("/v1/agent/x", { headers: { cookie: "session=user" } }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "bearer_mint_failed" });
  });

  it("answers an unknown route with 404 before identifying the caller", async () => {
    const response = await routes.backend.GET(
      request("/api/not-allowed", {
        headers: { authorization: "Bearer aomi_wst_revoked" },
      }),
    );
    expect(response.status).toBe(404);
    const apps = await routes.accountApps.GET(
      request("/v1/account/apps/abc", { headers: { cookie: "session=user" } }),
    );
    expect(apps.status).toBe(404);
    expect(await apps.json()).toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });
});

describe("/v1/commits forwarding", () => {
  const cookie = { cookie: "session=user" };
  it.each([
    ["GET", "/v1/commits/cmt_1", routes.commits.GET],
    ["POST", "/v1/commits/cmt_1/sign", routes.commits.POST],
    ["POST", "/v1/commits/cmt_1/broadcast", routes.commits.POST],
    ["POST", "/v1/commits/cmt_1/reject", routes.commits.POST],
    ["POST", "/v1/commits/cmt_1/attempts", routes.commits.POST],
    ["POST", "/v1/commits/cmt_1/attempts/att_2/report", routes.commits.POST],
    ["POST", "/v1/commits/cmt_1/approve", routes.commits.POST],
  ] as const)(
    "%s %s reaches the backend as the account",
    async (method, path, handler) => {
      const response = await handler(
        request(path, { method, headers: cookie, origin: PORTAL }),
      );
      expect(response.status).toBe(200);
      const [call] = upstreamCalls();
      expect(call.url).toBe(`https://backend.example${path}`);
      expect(call.headers.get("authorization")).toBe(
        "Bearer account:acct-user",
      );
      expect(call.headers.has("cookie")).toBe(false);
      expect(mocks.mintAccountBearer).toHaveBeenCalledWith(
        "acct-user",
        "user",
        {
          auth_source: "session",
          principal_class: "user",
        },
      );
    },
  );

  it.each([
    ["cookie user", "acct-user", "session", "user"],
    ["cookie guest", "acct-guest", "session", "guest"],
    ["e2e cookie", "acct-e2e", "session", "user"],
    ["session bearer", "acct-user", "cli_session", "user"],
    ["widget user", "acct-widget", "widget", "user"],
    ["widget guest", "acct-widget-guest", "widget", "guest"],
    ["OAuth user", "acct-user", "oauth", "user"],
    ["OAuth guest", "acct-guest", "oauth", "guest"],
  ])(
    "names the client a %s came through on every call",
    async (credential, subject, source, principalClass) => {
      const { headers, origin } = CREDENTIALS[credential];
      for (const [method, path, handler] of [
        ["GET", "/v1/commits/cmt_1", routes.commits.GET],
        ["POST", "/v1/commits/cmt_1/reject", routes.commits.POST],
      ] as const)
        expect(
          (await handler(request(path, { method, headers, origin }))).status,
        ).toBe(200);
      expect(mocks.mintAccountBearer.mock.calls).toEqual([
        [
          subject,
          "user",
          { auth_source: source, principal_class: principalClass },
        ],
        [
          subject,
          "user",
          { auth_source: source, principal_class: principalClass },
        ],
      ]);
    },
  );

  it.each([
    ["cookie user", "session"],
    ["e2e cookie", "session"],
    ["session bearer", "cli_session"],
  ])("lets a %s approve", async (credential, source) => {
    const { headers, origin } = CREDENTIALS[credential];
    const response = await routes.commits.POST(
      request("/v1/commits/cmt_1/approve", { method: "POST", headers, origin }),
    );
    expect(response.status).toBe(200);
    expect(upstreamCalls()[0].url).toBe(
      "https://backend.example/v1/commits/cmt_1/approve",
    );
    expect(mocks.mintAccountBearer).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      { auth_source: source, principal_class: "user" },
    );
  });

  it.each([
    "cookie guest",
    "widget user",
    "widget guest",
    "OAuth user",
    "OAuth guest",
  ])(
    "refuses approval from a %s without calling the backend",
    async (credential) => {
      const { headers, origin } = CREDENTIALS[credential];
      const response = await routes.commits.POST(
        request("/v1/commits/cmt_1/approve", {
          method: "POST",
          headers,
          origin,
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: "commit_approval_forbidden",
        status: 403,
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.mintAccountBearer).not.toHaveBeenCalled();
    },
  );

  it("asks an OAuth client for agent:write before refusing approval", async () => {
    const response = await routes.commits.POST(
      request("/v1/commits/cmt_1/approve", {
        method: "POST",
        headers: { authorization: "Bearer oauth.guest.jwt" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/v1/commits/cmt_1/manual"],
    ["GET", "/v1/commits/cmt_1/approve"],
    ["POST", "/v1/commits/cmt_1/approve/extra"],
    ["GET", "/v1/commits/cmt_1/sign"],
    ["POST", "/v1/commits/cmt_1"],
    ["GET", "/v1/commits/../api/secrets"],
  ] as const)(
    "answers %s %s with 404 before identifying the caller",
    async (method, path) => {
      const handler =
        method === "GET" ? routes.commits.GET : routes.commits.POST;
      const response = await handler(
        request(path, { method, headers: cookie, origin: PORTAL }),
      );
      expect(response.status).toBe(404);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("asks an OAuth caller for agent:read / agent:write, like api-server", async () => {
    const read = await routes.commits.GET(
      request("/v1/commits/cmt_1", {
        headers: { authorization: "Bearer oauth.user.jwt" },
      }),
    );
    expect(read.status).toBe(200);
    const write = await routes.commits.POST(
      request("/v1/commits/cmt_1/reject", {
        method: "POST",
        headers: { authorization: "Bearer oauth.user.jwt" },
      }),
    );
    expect(write.status).toBe(200);
  });

  it("requires a principal", async () => {
    const response = await routes.commits.GET(
      request("/v1/commits/cmt_1", { origin: PORTAL }),
    );
    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("/v1/account/wallets forwarding", () => {
  const cookie = { cookie: "session=user" };
  it.each([
    ["GET", "/v1/account/wallets", routes.accountWallets.GET],
    ["GET", "/v1/account/wallets/w_12/balance", routes.accountWallets.GET],
    ["GET", "/v1/account/agent-wallets", routes.accountWallets.GET],
    ["POST", "/v1/account/agent-wallets", routes.accountWallets.POST],
    ["PATCH", "/v1/account/agent-wallets/g-1", routes.accountWallets.PATCH],
    [
      "GET",
      "/v1/account/agent-wallets/g-1/balances",
      routes.accountWallets.GET,
    ],
    [
      "POST",
      "/v1/account/agent-wallets/g-1/withdraw",
      routes.accountWallets.POST,
    ],
    [
      "PUT",
      "/v1/account/connections/oauth%3Aclaude/wallets",
      routes.accountWallets.PUT,
    ],
    ["PUT", "/v1/account/pause-all", routes.accountWallets.PUT],
    [
      "PUT",
      "/v1/account/connection-settings/oauth%3Aclaude",
      routes.accountWallets.PUT,
    ],
  ] as const)(
    "%s %s reaches the backend as the account",
    async (method, path, handler) => {
      const response = await handler(
        request(path, { method, headers: cookie, origin: PORTAL }),
      );
      expect(response.status).toBe(200);
      const [call] = upstreamCalls();
      expect(call.url).toBe(`https://backend.example${path}`);
      expect(call.headers.get("authorization")).toBe(
        "Bearer account:acct-user",
      );
      expect(call.headers.has("cookie")).toBe(false);
    },
  );

  it.each([
    ["POST", "/v1/account/wallets"],
    ["POST", "/v1/account/wallets/agent"],
    ["PATCH", "/v1/account/agent-wallets"],
    ["POST", "/v1/account/agent-wallets/g-1"],
    ["GET", "/v1/account/agent-wallets/g-1/withdraw"],
    ["GET", "/v1/account/connections/portal/wallets"],
    ["GET", "/v1/account/wallets/12/balance"],
    ["GET", "/v1/account/wallets/w_0/balance"],
    ["GET", "/v1/account/wallets/w_12/balance/extra"],
    ["GET", "/v1/account/wallets/w_12/rule"],
    ["GET", "/v1/account/pause-all"],
    ["POST", "/v1/account/pause-all"],
    ["GET", "/v1/account/agent-rule"],
    ["GET", "/v1/account/connection-settings/portal"],
    ["PUT", "/v1/account/connection-settings/a/b"],
    ["PUT", "/v1/account/wallets/w_12/balance"],
  ] as const)(
    "answers %s %s with 404 before identifying the caller",
    async (method, path) => {
      const handler = routes.accountWallets[method];
      const response = await handler(
        request(path, { method, headers: cookie, origin: PORTAL }),
      );
      expect(response.status).toBe(404);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("lets an OAuth client read with agent:read, but never create", async () => {
    const auth = { authorization: "Bearer oauth.user.jwt" };
    const list = await routes.accountWallets.GET(
      request("/v1/account/wallets", { headers: auth }),
    );
    expect(list.status).toBe(200);
    const balance = await routes.accountWallets.GET(
      request("/v1/account/wallets/w_12/balance", { headers: auth }),
    );
    expect(balance.status).toBe(200);
    expect(upstreamCalls()).toHaveLength(2);
    const create = await routes.accountWallets.POST(
      request("/v1/account/agent-wallets", { method: "POST", headers: auth }),
    );
    expect(create.status).toBe(401);
    expect(upstreamCalls()).toHaveLength(2);
  });

  it.each([
    "cookie guest",
    "widget guest",
    "widget user",
    "session bearer",
    "OAuth user",
    "cookie user",
  ])(
    "agent creation admits only the portal session: %s",
    async (credential) => {
      const { headers, origin } = CREDENTIALS[credential];
      const response = await routes.accountWallets.POST(
        request("/v1/account/agent-wallets", {
          method: "POST",
          headers,
          origin,
        }),
      );
      expect(response.status).toBe(
        credential === "cookie user"
          ? 200
          : credential === "OAuth user"
            ? 401
            : 403,
      );
      if (credential === "cookie user") {
        expect(mocks.mintAccountBearer).toHaveBeenCalledWith(
          "acct-user",
          "user",
          { auth_source: "session", principal_class: "user" },
        );
      } else {
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["cookie user", 200],
    ["cookie guest", 403],
    ["widget user", 403],
    ["widget guest", 403],
    ["session bearer", 403],
    ["e2e cookie", 401],
    ["OAuth user", 401],
  ] as const)(
    "pause all admits only the portal session: %s",
    async (credential, status) => {
      const { headers, origin } = CREDENTIALS[credential];
      const response = await routes.accountWallets.PUT(
        request("/v1/account/pause-all", {
          method: "PUT",
          headers,
          origin,
          body: JSON.stringify({ paused: true }),
        }),
      );
      expect(response.status).toBe(status);
      if (status === 200) {
        expect(mocks.mintAccountBearer).toHaveBeenCalledWith(
          "acct-user",
          "user",
          { auth_source: "session", principal_class: "user" },
        );
      } else {
        if (status === 403)
          expect(await response.json()).toEqual({
            error: "portal_session_required",
          });
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    },
  );

  it("requires a principal", async () => {
    const response = await routes.accountWallets.GET(
      request("/v1/account/wallets", { origin: PORTAL }),
    );
    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("forwards the thread wallet switch like the thread safety level", async () => {
    const response = await routes.backend.PUT(
      request("/api/thread/wallet", {
        method: "PUT",
        headers: { ...cookie, "x-thread-id": "thread-1" },
        origin: PORTAL,
      }),
    );
    expect(response.status).toBe(200);
    const [call] = upstreamCalls();
    expect(call.url).toBe("https://backend.example/api/thread/wallet");
    expect(call.headers.get("x-thread-id")).toBe("thread-1");
    const read = await routes.backend.GET(
      request("/api/thread/wallet", { headers: cookie, origin: PORTAL }),
    );
    expect(read.status).toBe(404);
  });
});

describe("/v1/account/connections", () => {
  const CONNECTIONS = {
    oauth: [
      {
        client_id: "client-1",
        name: "Claude Code",
        kind: "mcp",
        connected_at: 1_760_400_000,
      },
    ],
    telegram: {
      username: "arixon",
      bots: [{ bot_id: "7712345678", label: "@HooditBot" }],
    },
  };
  const disconnect = (credential: string, clientId = "client-1") => {
    const { headers, origin } = CREDENTIALS[credential];
    return routes.connection.DELETE(
      request(`/v1/account/connections/oauth/${clientId}`, {
        method: "DELETE",
        headers,
        origin,
      }),
      { params: Promise.resolve({ client_id: clientId }) },
    );
  };

  it("lists the account's connections from the portal, not the backend", async () => {
    mocks.listConnections.mockResolvedValue(CONNECTIONS);
    const response = await routes.connections.GET(
      request("/v1/account/connections", {
        headers: { cookie: "session=user" },
        origin: PORTAL,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CONNECTIONS);
    expect(mocks.listConnections).toHaveBeenCalledWith("acct-user");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["OAuth user", 401],
    ["none", 401],
  ] as const)(
    "does not list connections for %s",
    async (credential, status) => {
      const { headers, origin } = CREDENTIALS[credential];
      const response = await routes.connections.GET(
        request("/v1/account/connections", { headers, origin }),
      );
      expect(response.status).toBe(status);
      expect(mocks.listConnections).not.toHaveBeenCalled();
    },
  );

  it("disconnects one OAuth client", async () => {
    mocks.revokeConnection.mockResolvedValue(true);
    const response = await disconnect("cookie user");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.revokeConnection).toHaveBeenCalledWith({
      userId: "acct-user",
      clientId: "client-1",
    });
  });

  it("answers 404 for a client the account is not connected to", async () => {
    mocks.revokeConnection.mockResolvedValue(false);
    const response = await disconnect("cookie user", "client-x");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "connection_not_found" });
  });

  it.each([
    ["cookie guest", 403],
    ["session bearer", 403],
    ["widget user", 403],
    ["OAuth user", 401],
  ] as const)(
    "only a portal session disconnects: %s",
    async (credential, status) => {
      const response = await disconnect(credential);
      expect(response.status).toBe(status);
      if (status === 403)
        expect(await response.json()).toEqual({
          error: "portal_session_required",
        });
      expect(mocks.revokeConnection).not.toHaveBeenCalled();
    },
  );
});

describe("/v1/account/link/telegram", () => {
  const code = "A".repeat(43);
  const post = (credential: string, action = "confirm") => {
    const { headers, origin } = CREDENTIALS[credential];
    return routes.telegramLink.POST(
      request(`/v1/account/link/telegram/${action}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        origin,
        body: JSON.stringify({ code }),
      }),
    );
  };

  it.each(["preview", "confirm", "cancel"])(
    "forwards %s for a portal session with the session claims",
    async (action) => {
      const response = await post("cookie user", action);
      expect(response.status).toBe(200);
      expect(mocks.consume).toHaveBeenCalledWith(
        `telegram-link:${action}:acct-user`,
        { window: 60, max: action === "preview" ? 20 : 5 },
      );
      const [call] = upstreamCalls();
      expect(call.url).toBe(
        `https://backend.example/v1/account/link/telegram/${action}`,
      );
      expect(call.headers.get("authorization")).toBe(
        "Bearer account:acct-user",
      );
      expect(call.headers.has("cookie")).toBe(false);
      expect(mocks.mintAccountBearer).toHaveBeenCalledWith(
        "acct-user",
        "user",
        {
          auth_source: "session",
          principal_class: "user",
        },
      );
      const [, init] = mocks.fetch.mock.calls[0]!;
      expect(JSON.parse(await new Response(init.body).text())).toEqual({
        code,
      });
    },
  );

  it.each([
    ["cookie guest", 403],
    ["widget user", 403],
    ["widget guest", 403],
    ["session bearer", 403],
    ["e2e cookie", 401],
    ["OAuth user", 401],
    ["none", 401],
  ] as const)("refuses %s", async (credential, status) => {
    const response = await post(credential);
    expect(response.status).toBe(status);
    if (status === 403)
      expect(await response.json()).toEqual({
        error: "portal_session_required",
      });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("refuses a cross-site cookie write", async () => {
    const response = await routes.telegramLink.POST(
      request("/v1/account/link/telegram/confirm", {
        method: "POST",
        headers: { cookie: "session=user" },
        origin: "https://evil.example",
        body: JSON.stringify({ code }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses an over-budget account before forwarding", async () => {
    mocks.consume.mockResolvedValueOnce({ allowed: false, retryAfter: null });
    const response = await post("cookie user");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("passes the backend's refusal through unchanged", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json(
        { error: "account_link_busy", in_flight: [{ id: "c-1" }] },
        { status: 409 },
      ),
    );
    const response = await post("cookie user");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "account_link_busy",
      in_flight: [{ id: "c-1" }],
    });
  });

  it("has no other actions or methods", async () => {
    const { headers, origin } = CREDENTIALS["cookie user"];
    const response = await routes.telegramLink.POST(
      request("/v1/account/link/telegram/unlink", {
        method: "POST",
        headers,
        origin,
      }),
    );
    expect(response.status).toBe(404);
    expect(Object.keys(routes.telegramLink).sort()).toEqual([
      "OPTIONS",
      "POST",
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("/api forwarding", () => {
  it.each([
    [[], "/api/thread/apps"],
    [
      ["somm.finance", "community"],
      "/api/thread/apps?platform=somm.finance&platform=community",
    ],
  ])("filters the thread app catalog to %j", async (platforms, upstream) => {
    vi.stubEnv("APP_CATALOG_PLATFORMS", platforms.join(","));
    await routes.backend.GET(request("/api/thread/apps"));
    expect(upstreamCalls()[0].url).toBe(`https://backend.example${upstream}`);
  });

  it("keeps a caller's explicit platform filter", async () => {
    vi.stubEnv("APP_CATALOG_PLATFORMS", "somm.finance");
    await routes.backend.GET(request("/api/thread/apps?platform=community"));
    expect(upstreamCalls()[0].url).toBe(
      "https://backend.example/api/thread/apps?platform=community",
    );
  });

  it("reaches bearer-independent routes without touching a session", async () => {
    await routes.backend.GET(
      request("/api/thread/models", {
        headers: { authorization: "Bearer aomi_wst_revoked" },
      }),
    );
    expect(upstreamCalls()[0].headers.has("authorization")).toBe(false);
  });
});

describe("scopes each agent API route asks for", () => {
  const signed = { cookie: "session=user" };
  it.each([
    ["GET", "/v1/agent/sessions", routes.agent.GET, {}, "agent:read"],
    [
      "POST",
      "/v1/agent/sessions/t/actions/a/result",
      routes.agent.POST,
      {},
      "agent:actions:resolve",
    ],
    [
      "POST",
      "/v1/agent/sessions",
      routes.agent.POST,
      { "payment-signature": "x" },
      "agent:write payments:submit",
    ],
    [
      "GET",
      "/v1/pipeline/catalog",
      routes.pipeline.GET,
      {},
      "pipeline:catalog",
    ],
    [
      "GET",
      "/v1/pipeline/evm/commits/c1",
      routes.pipeline.GET,
      {},
      "pipeline:execute",
    ],
    [
      "POST",
      "/v1/account/credits/top-up",
      routes.topUp.POST,
      { "payment-signature": "x" },
      "account:credits:topup payments:submit",
    ],
    [
      "GET",
      "/v1/account/statement",
      routes.statement.GET,
      {},
      "account:usage:read",
    ],
    [
      "GET",
      "/v1/account/apps",
      routes.accountApps.GET,
      {},
      "account:apps:read",
    ],
    [
      "DELETE",
      "/v1/account/apps/7/secrets/API_KEY",
      routes.accountApps.DELETE,
      {},
      "account:credentials:write",
    ],
    [
      "PUT",
      "/v1/account/transaction-safety/threads/t1",
      routes.transactionSafety.PUT,
      {},
      "account:transaction-safety:write",
    ],
  ] as const)("%s %s", async (method, path, handler, headers, scope) => {
    const response = await handler(
      request(path, {
        method,
        headers: { ...signed, ...headers },
        origin: PORTAL,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.mintAgentApiBearer.mock.calls[0][1].scope).toBe(scope);
    expect(upstreamCalls()[0].url).toBe(`https://agent.example${path}`);
  });

  it.each([
    [
      "the account control plane",
      routes.transactionSafety.GET,
      "/v1/account/transaction-safety",
    ],
    ["app secrets", routes.accountApps.GET, "/v1/account/apps"],
  ])("keeps guests away from %s", async (_name, handler, path) => {
    const response = await handler(
      request(path, {
        headers: { authorization: "Bearer aomi_wst_guest" },
        origin: PARTNER,
      }),
    );
    expect(response.status).toBe(403);
  });

  it("gives MCP the grant's scopes for its own resource and lets Rust classify tools", async () => {
    const response = await routes.agentMcp.POST(
      request("/v1/agent/mcp", {
        method: "POST",
        headers: { authorization: "Bearer mcp.user.jwt" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.mintAgentApiBearer).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        scope: "mcp:agent agent:read agent:write",
        auth_source: "oauth",
        resource: `${PORTAL}/v1/agent/mcp`,
      }),
    );
    expect(upstreamCalls()[0].url).toBe("https://agent.example/v1/agent/mcp");
  });

  it("takes a /v1 token on REST, narrowed to the route's scopes, and never on MCP", async () => {
    const rest = await routes.agent.POST(
      request("/v1/agent/sessions", {
        method: "POST",
        headers: { authorization: "Bearer api.user.jwt" },
        body: "{}",
      }),
    );
    expect(rest.status).toBe(200);
    expect(mocks.mintAgentApiBearer).toHaveBeenCalledWith(
      user,
      // Only the route's own scope reaches the API; no pipeline or account.
      expect.objectContaining({
        scope: "agent:write",
        resource: `${PORTAL}/v1/agent`,
      }),
    );
    const mcp = await routes.agentMcp.POST(
      request("/v1/agent/mcp", {
        method: "POST",
        headers: { authorization: "Bearer api.user.jwt" },
        body: "{}",
      }),
    );
    expect(mcp.status).toBe(401);
  });

  it("refuses an MCP payment without payments:submit", async () => {
    const response = await routes.agentMcp.POST(
      request("/v1/agent/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer mcp.user.jwt",
          "payment-signature": "x",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("locks app MCP to its own path: another resource's token and bad names fail", async () => {
    const borrowed = await routes.appMcp.POST(
      request("/v1/apps/world/mcp", {
        method: "POST",
        headers: { authorization: "Bearer mcp.user.jwt" },
        body: "{}",
      }),
    );
    expect(borrowed.status).toBe(401);
    for (const path of ["/v1/apps/World/mcp", "/v1/apps/-x/mcp"]) {
      const response = await routes.appMcp.POST(
        request(path, {
          method: "POST",
          headers: { authorization: "Bearer mcp.user.jwt" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(404);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("dev tools", () => {
  it.each([
    ["VERCEL", "1"],
    ["VERCEL_ENV", "preview"],
    ["NODE_ENV", "production"],
  ])("the E2E wallet routes do not exist with %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    const seed = await routes.e2eWallet.GET(
      new NextRequest(`${PORTAL}/api/bff/e2e/wallet?token=x`),
    );
    const execute = await routes.e2eExecute.POST(
      new NextRequest(`${PORTAL}/api/bff/e2e/execute`, { method: "POST" }),
    );
    expect([seed.status, execute.status]).toEqual([404, 404]);
  });
});

describe("simulation world setup", () => {
  it("forwards a widget account's seed with its thread and user state", async () => {
    const body = JSON.stringify({
      forks: [{ chain_id: 5042002, overrides: [] }],
    });
    const path = "/api/thread/sim/world?user_state=%7B%7D";
    const response = await routes.backend.POST(
      request(path, {
        method: "POST",
        origin: PARTNER,
        headers: {
          authorization: "Bearer aomi_wst_user",
          "content-type": "application/json",
          "x-session-id": "seed-thread",
          "x-thread-id": "seed-thread",
        },
        body,
      }),
    );
    expect(response.status).toBe(200);
    const call = upstreamCalls()[0];
    expect(call.url).toBe(`https://backend.example${path}`);
    expect(call.headers.get("x-thread-id")).toBe("seed-thread");
    expect(call.headers.get("x-session-id")).toBe("seed-thread");
    expect(call.headers.get("authorization")).toBe(
      "Bearer account:acct-widget",
    );
    expect(
      await new Response(
        (mocks.fetch.mock.calls[0][1] as RequestInit).body,
      ).text(),
    ).toBe(body);
  });

  it("requires authentication and only exposes POST", async () => {
    const response = await routes.backend.POST(
      request("/api/thread/sim/world", {
        method: "POST",
        origin: PORTAL,
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    const read = await routes.backend.GET(
      request("/api/thread/sim/world", CREDENTIALS["widget user"]),
    );
    expect(read.status).toBe(404);
    expect(upstreamCalls()).toHaveLength(0);
  });
});
