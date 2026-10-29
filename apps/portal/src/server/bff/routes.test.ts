// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PORTAL = "https://portal.example";
const PARTNER = "https://partner.example";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  managedClient: vi.fn(),
  e2eAccountId: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
  listConnections: vi.fn(),
  revokeConnection: vi.fn(),
}));

// One table of credentials stands in for Better Auth and widget sessions;
// everything above them (resolver, capabilities,
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
function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.split(/\s+/)[1];
}

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
  "/v1/account/session/cli": [
    "POST",
    "/v1/account/session/cli",
    routes.cliSession.POST,
  ],
} as const;
type FamilyName = keyof typeof FAMILIES;

type Outcome = number;
const MATRIX: Record<string, Record<FamilyName, Outcome>> = {
  "cookie user": {
    "/v1/account": 200,
    "/v1/account/session/cli": 403,
  },
  "cookie guest": {
    "/v1/account": 200,
    "/v1/account/session/cli": 403,
  },
  "session bearer": {
    "/v1/account": 200,
    "/v1/account/session/cli": 200,
  },
  "widget user": {
    "/v1/account": 200,
    "/v1/account/session/cli": 403,
  },
  "widget guest": {
    "/v1/account": 200,
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
      expect(response.status).toBe(outcome);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["Bearer oauth.user.jwt", "DPoP oauth.user.jwt"])(
    "rejects %s without falling back to a valid session cookie",
    async (authorization) => {
      const response = await routes.account.GET(
        request("/v1/account", {
          headers: { authorization, cookie: "session=user", dpop: "proof" },
          origin: PORTAL,
        }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_token" });
      expect(mocks.fetch).not.toHaveBeenCalled();
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
