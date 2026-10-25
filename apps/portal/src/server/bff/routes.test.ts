// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PORTAL = "https://portal.example";
const PARTNER = "https://partner.example";

const mocks = vi.hoisted(() => ({
  mintAccountBearer: vi.fn(),
  mintDelegatedBearer: vi.fn(),
  fetch: vi.fn(),
  managedClient: vi.fn(),
  e2eAccountId: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
}));

// One table of credentials stands in for Better Auth, widget sessions and the
// OAuth resource server; everything above them (resolver, capabilities,
// error mapping, CORS) is the real pipeline. The proxy families (/api, /v1/agent,
// /v1/pipeline, credits, statement, apps, transaction safety, MCP) left for the
// edge Worker; apps/edge/src/portal/portal.test.ts covers them.
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

vi.mock("@aomi-labs/account", () => ({
  mintAccountBearer: mocks.mintAccountBearer,
  mintDelegatedBearer: mocks.mintDelegatedBearer,
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
          verifyOptions: { audience: string };
          requiredScopes: string[];
        },
      ) => {
        const claims = claimsFor(bearerToken(request) ?? "");
        if (!claims || claims.aud !== options.verifyOptions.audience)
          throw Object.assign(new Error("bad token"), { status: 401 });
        const granted = claims.scope.split(" ");
        if (options.requiredScopes.some((scope) => !granted.includes(scope)))
          throw Object.assign(new Error("scope"), { status: 403 });
        return claims;
      },
    }),
  }),
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
  "/v1/account": ["GET", "/v1/account", routes.account.GET],
  "/v1/account/bearer": ["GET", "/v1/account/bearer", routes.bearer.GET],
  "/v1/account/session/cli": [
    "POST",
    "/v1/account/session/cli",
    routes.cliSession.POST,
  ],
} as const;
type FamilyName = keyof typeof FAMILIES;

// Minted: the account bearer subject, where the route mints one.
type Outcome = number | [200, string];
const user = "acct-user";
const MATRIX: Record<string, Record<FamilyName, Outcome>> = {
  "cookie user": {
    "/v1/account": 200,
    "/v1/account/bearer": [200, user],
    "/v1/account/session/cli": 403,
  },
  "cookie guest": {
    "/v1/account": 200,
    "/v1/account/bearer": [200, "acct-guest"],
    "/v1/account/session/cli": 403,
  },
  "session bearer": {
    "/v1/account": 200,
    "/v1/account/bearer": [200, user],
    "/v1/account/session/cli": 200,
  },
  "widget user": {
    "/v1/account": 200,
    "/v1/account/bearer": 403,
    "/v1/account/session/cli": 403,
  },
  "widget guest": {
    "/v1/account": 200,
    "/v1/account/bearer": 403,
    "/v1/account/session/cli": 403,
  },
  "widget, wrong origin": allStatus(401),
  "invalid widget session": allStatus(401),
  "OAuth user": allStatus(401),
  "OAuth user, DPoP": allStatus(401),
  "OAuth guest": allStatus(401),
  none: {
    ...allStatus(401),
    "/v1/account": 200,
  },
  "e2e cookie": {
    "/v1/account": 200,
    "/v1/account/bearer": [200, "acct-e2e"],
    "/v1/account/session/cli": 401,
  },
  "e2e cookie on Vercel": {
    ...allStatus(401),
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
  vi.stubEnv("BACKEND_URL", "https://backend.example");
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
  mocks.mintDelegatedBearer
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
      const [status, subject] = Array.isArray(outcome) ? outcome : [outcome];
      expect(response.status).toBe(status);
      if (status !== 200) {
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.mintAccountBearer).not.toHaveBeenCalled();
        return;
      }
      if (subject) expect(mocks.mintAccountBearer).toHaveBeenCalledWith(subject);
      else expect(mocks.mintAccountBearer).not.toHaveBeenCalled();
      for (const call of upstreamCalls())
        expect(call.headers.has("cookie")).toBe(false);
    },
  );

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

describe("CSRF on cookie-authenticated requests", () => {
  it("ignores the cookie on a cross-site read", async () => {
    const response = await routes.account.GET(
      request("/v1/account", {
        headers: { cookie: "session=user" },
        origin: "https://hostile.example",
      }),
    );
    expect(await response.json()).toMatchObject({ user: null, session: null });
  });
});

describe("CORS per family", () => {
  it.each([
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
