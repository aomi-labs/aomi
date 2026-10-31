// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PORTAL = "https://portal.example";
var PARTNER = "https://partner.example";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  managedClient: vi.fn(),
  listConnections: vi.fn(),
  revokeConnection: vi.fn(),
}));

// One table of credentials stands in for Better Auth and widget sessions;
// everything above them (the edge's resolver, capabilities, error mapping,
// CORS) is the real pipeline. The proxy families (/api, /v1/agent,
// /v1/pipeline, credits, statement, apps, transaction safety, MCP) are covered
// by apps/edge/src/portal/portal.test.ts.
var SESSIONS: Record<
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
var WIDGETS: Record<
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

vi.mock("@aomi-labs/account/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/account")>()),
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
}));
vi.mock("@aomi-labs/account/better-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/better-auth")>()),
  readManagedOAuthClient: async (clientId: string) =>
    mocks.managedClient(clientId),
  listManagedWidgetOrigins: async () => ["https://managed.example"],
}));
vi.mock("./server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server")>()),
  authServer: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = headers.get("authorization")?.split(/\s+/)[1];
        if (headers.has("authorization")) return SESSIONS[token ?? ""] ?? null;
        const cookie = /session=(\w+)/.exec(headers.get("cookie") ?? "")?.[1];
        return cookie ? (SESSIONS[cookie] ?? null) : null;
      },
    },
  }),
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
import type { EdgeEnv } from "../env";
import { handleRequest } from "../handler";

const env: EdgeEnv = {
  PORTAL_HOSTS: "portal.example",
  PORTAL_UPSTREAM_ORIGIN: "https://pages.example",
  API_SERVER_ORIGIN: "https://agent.example",
};

/** The edge, as a portal host's /api and /v1 caller sees it. */
function edge(path: string, init: RequestInit & { origin?: string } = {}) {
  return handleRequest(request(path, init), env, mocks.fetch);
}

function request(path: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`${PORTAL}${path}`, { ...init, headers });
}

type Credential = {
  headers: Record<string, string>;
  origin?: string;
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
};

const FAMILIES = {
  "/v1/account": ["GET", "/v1/account"],
} as const;
type FamilyName = keyof typeof FAMILIES;

type Outcome = number;
const MATRIX: Record<string, Record<FamilyName, Outcome>> = {
  "cookie user": {
    "/v1/account": 200,
  },
  "cookie guest": {
    "/v1/account": 200,
  },
  "session bearer": {
    "/v1/account": 200,
  },
  "widget user": {
    "/v1/account": 200,
  },
  "widget guest": {
    "/v1/account": 200,
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
};

function allStatus(status: number): Record<FamilyName, Outcome> {
  return Object.fromEntries(
    Object.keys(FAMILIES).map((family) => [family, status]),
  ) as Record<FamilyName, Outcome>;
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", PORTAL);
  mocks.fetch
    .mockReset()
    .mockImplementation(async () => Response.json({ ok: true }));
  mocks.managedClient.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
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
      const { headers, origin } = CREDENTIALS[credential];
      const [method, path] = FAMILIES[family];
      const response = await edge(path, { method, headers, origin });
      expect(response.status).toBe(outcome);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["Bearer oauth.user.jwt", "DPoP oauth.user.jwt"])(
    "rejects %s without falling back to a valid session cookie",
    async (authorization) => {
      const response = await edge("/v1/account", {
        headers: { authorization, cookie: "session=user", dpop: "proof" },
        origin: PORTAL,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_token" });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("returns the guest projection without exposing the session token", async () => {
    const response = await edge("/v1/account", {
      headers: { cookie: "session=guest" },
    });
    expect(await response.json()).toEqual({
      guest: true,
      user: null,
      linkedAccounts: [],
      wallets: [],
      session: { carrier: "better_auth", betterAuthUserId: "guest" },
    });
  });
});

describe("CSRF on cookie-authenticated requests", () => {
  it("ignores the cookie on a cross-site read", async () => {
    const response = await edge("/v1/account", {
      headers: { cookie: "session=user" },
      origin: "https://hostile.example",
    });
    expect(await response.json()).toMatchObject({ user: null, session: null });
  });
});

describe("CORS per family", () => {
  it.each([
    [
      "widget sign-in",
      () =>
        edge("/api/auth/widget/siwe/nonce", {
          method: "OPTIONS",
          origin: PARTNER,
        }),
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
    return edge(`/v1/account/connections/oauth/${clientId}`, {
      method: "DELETE",
      headers,
      origin,
    });
  };

  it("lists the account's connections from the account graph, not the backend", async () => {
    mocks.listConnections.mockResolvedValue(CONNECTIONS);
    const response = await edge("/v1/account/connections", {
      headers: { cookie: "session=user" },
      origin: PORTAL,
    });
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
      const response = await edge("/v1/account/connections", {
        headers,
        origin,
      });
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

describe("the route table", () => {
  it("has exactly one handler for each account route", async () => {
    const { ROUTES } = await import("@aomi-labs/account/policy");
    const { HANDLERS } = await import("./routes");
    const owned = ROUTES.filter((route) => route.to === "account");
    expect(owned.map((route) => route.operation).sort()).toEqual(
      Object.keys(HANDLERS).sort(),
    );
    for (const route of owned)
      expect(Object.keys(route.methods).sort()).toEqual(
        Object.keys(HANDLERS[route.operation]!.handle).sort(),
      );
  });
});
