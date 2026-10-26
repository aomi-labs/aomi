// @vitest-environment node
import {
  calculateJwkThumbprint,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWK,
  type KeyLike,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { handleRequest } from "../handler";
import { resetEdgeServices } from "../identity";
import type { FetchLike } from "../routing/upstream";
import { resetJwksCache } from "./jwks";
import { resetPrincipalCaches } from "./principal";

const PORTAL = "https://portal.example";
const UPSTREAM = "https://portal-vercel.example";
const PARTNER = "https://partner.example";
const AGENT = "https://agent.example";
const PAYMENT = "https://payment.example";
const BACKEND = "https://backend.example";
const MANAGER = "https://manager.example";
const ISSUER = `${PORTAL}/api/auth`;

const DEV_PRIVATE_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEIAJez/5pUy9hG5xNVsHP+4GQ6ZgxHDdzFoZ2GwvkHgx/",
  "-----END PRIVATE KEY-----",
].join("\n");
const DEV_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAuqXC9aHQt49M938ZGYqDBCvqJn6PZP0GzPArcG9eCCw=",
  "-----END PUBLIC KEY-----",
].join("\n");

const env: EdgeEnv = {
  PORTAL_HOSTS: "portal.example",
  PORTAL_UPSTREAM_ORIGIN: UPSTREAM,
  API_SERVER_ORIGIN: AGENT,
  PAYMENT_ORIGIN: PAYMENT,
  BACKEND_ORIGINS: BACKEND,
  APP_CATALOG_PLATFORMS: "web,telegram",
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

// The portal's Better Auth signing key, as its JWKS publishes it.
let portalKey: { privateKey: KeyLike; jwks: { keys: JWK[] } };
let edgePublicKey: KeyLike;

const SESSIONS: Record<string, { sub: string; guest: boolean }> = {
  user: { sub: "acct-user", guest: false },
  guest: { sub: "acct-guest", guest: true },
};
const WIDGETS: Record<string, { sub: string; origin: string; guest: boolean; expiresAt?: number }> = {
  aomi_wst_user: { sub: "acct-widget", origin: PARTNER, guest: false },
  aomi_wst_guest: { sub: "acct-widget-guest", origin: PARTNER, guest: true },
  // A session the portal still describes but whose own lifetime has ended.
  aomi_wst_stale: { sub: "acct-widget-stale", origin: PARTNER, guest: true, expiresAt: 1_700_000_000 },
};

async function signPortal(claims: Record<string, unknown>, options: { aud: string; exp?: number } = { aud: "aomi-edge" }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "portal-1" })
    .setIssuer(ISSUER)
    .setAudience(options.aud)
    .setIssuedAt(now)
    .setExpirationTime(options.exp ?? now + 300)
    .sign(portalKey.privateKey);
}

async function oauthToken(input: {
  sub: string;
  guest?: boolean;
  scope: string;
  aud: string;
  cnf?: { jkt: string };
}) {
  return signPortal(
    {
      sub: input.sub,
      scope: input.scope,
      client_id: "client-1",
      jti: "grant-1",
      "https://aomi.dev/canonical_user_id": `acct-${input.sub}`,
      "https://aomi.dev/principal_class": input.guest ? "guest" : "user",
      ...(input.cnf ? { cnf: input.cnf } : {}),
    },
    { aud: input.aud },
  );
}

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
let seen: Seen[];
let principalCalls: number;

function echo(request: Request, body: string, tag: string): Response {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => (headers[name] = value));
  const record = { url: request.url, method: request.method, headers, body };
  seen.push(record);
  return Response.json({ tag, ...record }, { headers: { "x-request-id": "rid-1", "set-cookie": "nope=1" } });
}

/** The portal upstream (Vercel), the agent API, the payment service and the backend, faked. */
const world: FetchLike = async (request) => {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  if (url.origin === UPSTREAM) {
    if (url.pathname === "/api/auth/jwks") return Response.json(portalKey.jwks);
    if (url.pathname === "/api/auth/edge/principal") {
      principalCalls += 1;
      const authorization = request.headers.get("authorization") ?? "";
      if (authorization.startsWith("Bearer aomi_wst_")) {
        const widget = WIDGETS[authorization.slice("Bearer ".length)];
        if (!widget || widget.origin !== request.headers.get("origin"))
          return Response.json({ error: "invalid_widget_session" }, { status: 401 });
        return Response.json({
          token: await signPortal({
            sub: widget.sub,
            kind: "widget",
            guest: widget.guest,
            origin: widget.origin,
            auth_method: widget.guest ? "anonymous" : "siwe",
            expires_at: widget.expiresAt ?? 1_900_000_000,
          }),
        });
      }
      if (authorization) {
        const session = SESSIONS[authorization.slice("Bearer ".length)];
        if (!session) return Response.json({ error: "invalid_token" }, { status: 401 });
        return Response.json({ token: await signPortal({ ...session, kind: "session_bearer" }) });
      }
      const cookie = /session=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
      const session = cookie ? SESSIONS[cookie] : undefined;
      if (!session) return new Response(null, { status: 204 });
      return Response.json({ token: await signPortal({ ...session, kind: "cookie" }) });
    }
    if (url.pathname === "/api/auth/edge/managed-origin") {
      return Response.json({
        allowed:
          url.searchParams.get("client_id") === "client-1" &&
          url.searchParams.get("origin") === PARTNER,
      });
    }
    return echo(request, body, "vercel");
  }
  if (url.origin === AGENT) return echo(request, body, "agent");
  if (url.origin === MANAGER) return echo(request, body, "manager");
  if (url.origin === PAYMENT) return echo(request, body, "payment");
  if (url.origin === BACKEND) {
    if (url.pathname === "/api/thread/models") return Response.json(["gpt", 3, "claude"]);
    if (url.pathname === "/api/resource/skills")
      return new Response(null, { status: 302, headers: { location: `${BACKEND}/elsewhere` } });
    return echo(request, body, "backend");
  }
  return new Response("unexpected origin", { status: 599 });
};

function portal(path: string, init: RequestInit & { origin?: string; env?: Partial<EdgeEnv> } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return handleRequest(new Request(`${PORTAL}${path}`, { ...init, headers }), { ...env, ...init.env }, world);
}

/** An EDGE_CACHE binding that remembers everything and records what it was told. */
function fakeCache(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const log: string[] = [];
  return {
    store,
    log,
    async get(key: string) {
      log.push(`get ${key}`);
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      log.push(`put ${key}`);
      store.set(key, value);
    },
    async delete(key: string) {
      log.push(`delete ${key}`);
      store.delete(key);
    },
  };
}

async function upstreamBearer(record: Seen) {
  const token = record.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const { payload, protectedHeader } = await jwtVerify(token, edgePublicKey, {
    issuer: "aomi-edge",
  });
  return { payload, kid: protectedHeader.kid };
}

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await exportJWK(pair.publicKey);
  portalKey = {
    privateKey: pair.privateKey,
    jwks: { keys: [{ ...jwk, kid: "portal-1", alg: "EdDSA", use: "sig" }] },
  };
  edgePublicKey = await importSPKI(DEV_PUBLIC_KEY, "EdDSA");
});

beforeEach(() => {
  seen = [];
  principalCalls = 0;
  resetJwksCache();
  resetPrincipalCaches();
  resetEdgeServices();
});

describe("portal surface: sessions", () => {
  it("turns a session cookie into an aomi-edge bearer scoped to the agent resource", async () => {
    const response = await portal("/v1/agent/sessions?limit=2", {
      headers: { cookie: "session=user", "x-session-id": "thread-1" },
      origin: PORTAL,
    });
    expect(response.status).toBe(200);
    const [upstream] = seen;
    expect(upstream.url).toBe(`${AGENT}/v1/agent/sessions?limit=2`);
    expect(upstream.headers.cookie).toBeUndefined();
    expect(upstream.headers["x-thread-id"]).toBe("thread-1");
    const { payload, kid } = await upstreamBearer(upstream);
    expect(kid).toBe("aomi-edge-dev-1");
    expect(payload).toMatchObject({
      sub: "acct-user",
      aud: "aomi-api-server",
      role: "user",
      scope: "agent:read",
      resource: `${PORTAL}/v1/agent`,
      auth_source: "session",
      principal_class: "user",
      sid: "session-bound",
    });
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    // Only the policy's response headers come back, never the upstream cookie.
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("rid-1");
    expect(response.headers.get("server-timing")).toMatch(/edge_auth;dur=/);
  });

  it("exchanges the cookie once and reuses the signed principal until it expires", async () => {
    await portal("/v1/agent/sessions", { headers: { cookie: "session=user" }, origin: PORTAL });
    await portal("/v1/agent/sessions", { headers: { cookie: "session=user" }, origin: PORTAL });
    expect(principalCalls).toBe(1);
    await portal("/v1/agent/sessions", { headers: { cookie: "session=guest" }, origin: PORTAL });
    expect(principalCalls).toBe(2);
  });

  it("treats a cached principal whose signature has lapsed as a miss, not an outage", async () => {
    // KV keeps an entry for at least a minute, so it can hand back a principal
    // token that expired seconds ago. The Worker must exchange again, not 502.
    const stale = await signPortal(
      { sub: "acct-user", kind: "cookie", guest: false },
      { aud: "aomi-edge", exp: Math.floor(Date.now() / 1000) - 5 },
    );
    const cache = fakeCache();
    const probe = fakeCache();
    // Learn the cache key the Worker derives for this cookie, then plant the stale token under it.
    await portal("/v1/agent/sessions", { headers: { cookie: "session=user" }, origin: PORTAL, env: { EDGE_CACHE: probe } });
    const key = probe.log.find((entry) => entry.startsWith("put principal:"))!.slice(4);
    cache.store.set(key, stale);
    resetPrincipalCaches();
    principalCalls = 0;
    seen = [];

    const response = await portal("/v1/agent/sessions", {
      headers: { cookie: "session=user" },
      origin: PORTAL,
      env: { EDGE_CACHE: cache },
    });
    expect(response.status).toBe(200);
    expect(principalCalls).toBe(1);
    expect(cache.log.filter((entry) => entry.includes("principal:"))).toEqual([`get ${key}`, `delete ${key}`, `put ${key}`]);
    expect(cache.store.get(key)).not.toBe(stale);
    expect((await upstreamBearer(seen[0])).payload.sub).toBe("acct-user");
  });

  it("refuses a cookie write without a trusted origin (CSRF)", async () => {
    const response = await portal("/v1/agent/chat", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toHaveLength(0);
  });

  it("ignores a cookie presented from a foreign origin on a read", async () => {
    const response = await portal("/v1/agent/sessions", {
      headers: { cookie: "session=user" },
      origin: "https://evil.example",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${PORTAL}/.well-known/oauth-protected-resource/v1/agent"`,
    );
  });

  it("adds custody:delegate to a signed-in user's agent write and withholds it from guests", async () => {
    await portal("/v1/agent/chat", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json" },
      origin: PORTAL,
      body: "{}",
    });
    expect((await upstreamBearer(seen[0])).payload.scope).toBe("agent:write custody:delegate");
    await portal("/v1/agent/chat", {
      method: "POST",
      headers: { cookie: "session=guest", "content-type": "application/json", "payment-signature": "p" },
      origin: PORTAL,
      body: "{}",
    });
    // A guest holds no payments capability, so a paid write is refused.
    expect(seen).toHaveLength(1);
  });

  it("answers an unknown Better Auth bearer with 401 and a known one as a session bearer", async () => {
    const bad = await portal("/v1/agent/sessions", { headers: { authorization: "Bearer nobody" } });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_token" } });
    const good = await portal("/v1/account/apps", { headers: { authorization: "Bearer user" } });
    expect(good.status).toBe(200);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({
      scope: "account:apps:read",
      resource: `${PORTAL}/v1/account`,
    });
  });
});

describe("portal surface: widget sessions", () => {
  it("accepts a widget session from its bound origin and echoes that origin", async () => {
    const response = await portal("/v1/agent/chat", {
      method: "POST",
      headers: { authorization: "Bearer aomi_wst_user", "content-type": "application/json" },
      origin: PARTNER,
      body: '{"message":"hi"}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(PARTNER);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("vary")).toContain("Origin");
    const { payload } = await upstreamBearer(seen[0]);
    expect(payload).toMatchObject({ sub: "acct-widget", auth_source: "session", scope: "agent:write custody:delegate" });
    expect(seen[0].body).toBe('{"message":"hi"}');
  });

  it("refuses a widget session past its own expiry even while the signed principal is fresh", async () => {
    const response = await portal("/v1/agent/sessions", {
      headers: { authorization: "Bearer aomi_wst_stale" },
      origin: PARTNER,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_widget_session" } });
    expect(seen).toHaveLength(0);
    // Not remembered: the next call asks the portal again.
    await portal("/v1/agent/sessions", { headers: { authorization: "Bearer aomi_wst_stale" }, origin: PARTNER });
    expect(principalCalls).toBe(2);
  });

  it("refuses a widget session from another origin and never falls back to a cookie", async () => {
    const response = await portal("/v1/agent/sessions", {
      headers: { authorization: "Bearer aomi_wst_user", cookie: "session=user" },
      origin: "https://other.example",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_widget_session" } });
  });

  it("denies embedded sessions the capabilities a backend bearer would need", async () => {
    const response = await portal("/api/account", {
      headers: { authorization: "Bearer aomi_wst_guest" },
      origin: PARTNER,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "insufficient_scope" });
  });
});

describe("portal surface: OAuth tokens", () => {
  describe.each(["/api/thread/model", "/api/thread/sim/world"])("Fuzzer setup %s", (path) => {
    it.each([false, true])("forwards Agent write for guest=%s with the canonical account", async (guest) => {
      const token = await oauthToken({ sub: guest ? "guest" : "user", guest, scope: "agent:write", aud: `${PORTAL}/v1/agent` });
      const body = JSON.stringify({ forks: [{ chain_id: 5042002, overrides: [] }] });
      const response = await portal(`${path}?user_state=%7B%7D`, {
        method: "POST",
        origin: PARTNER,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-session-id": "seed-thread" },
        body,
      });
      expect(response.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        url: `${BACKEND}${path}?user_state=%7B%7D`,
        method: "POST",
        body,
        headers: { "x-thread-id": "seed-thread", "x-session-id": "seed-thread" },
      });
      expect((await upstreamBearer(seen[0])).payload).toMatchObject({ sub: guest ? "acct-guest" : "acct-user", aud: "aomi-backend" });
    });

    it("binds DPoP to the public URL despite spoofed forwarding headers", async () => {
      const key = await generateKeyPair("ES256");
      const jwk = await exportJWK(key.publicKey);
      const token = await oauthToken({
        sub: "user", scope: "agent:write", aud: `${PORTAL}/v1/agent`,
        cnf: { jkt: await calculateJwkThumbprint(jwk) },
      });
      const proof = (origin: string) => new SignJWT({
        htm: "POST", htu: `${origin}${path}`, jti: crypto.randomUUID(),
        ath: Buffer.from(new Uint8Array(tokenHash)).toString("base64url"),
      }).setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk }).setIssuedAt().sign(key.privateKey);
      const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      for (const [origin, status] of [[UPSTREAM, 401], [PORTAL, 200]] as const) {
        const response = await portal(path, {
          method: "POST",
          headers: {
            authorization: `DPoP ${token}`, dpop: await proof(origin),
            host: "attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http",
          },
          body: "{}",
        });
        expect(response.status).toBe(status);
      }
      expect(seen).toHaveLength(1);
      expect(seen[0].headers.dpop).toBeUndefined();
    });

    it("preserves anonymous, cookie and widget access rules", async () => {
      const anonymous = await portal(path, { method: "POST", body: "{}" });
      expect(anonymous.status).toBe(path === "/api/thread/model" ? 200 : 401);
      const cookie = await portal(path, { method: "POST", origin: PARTNER, headers: { cookie: "session=user" }, body: "{}" });
      expect(cookie.status).toBe(403);
      const widget = await portal(path, { method: "POST", origin: PARTNER, headers: { authorization: "Bearer aomi_wst_user" }, body: "{}" });
      expect(widget.status).toBe(200);
    });
  });


  it("verifies an access token against the portal JWKS and forwards an oauth-sourced bearer", async () => {
    const token = await oauthToken({
      sub: "user",
      scope: "agent:read agent:write custody:delegate",
      aud: `${PORTAL}/v1/agent`,
    });
    const response = await portal("/v1/agent/sessions", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const { payload } = await upstreamBearer(seen[0]);
    expect(payload).toMatchObject({
      sub: "acct-user",
      scope: "agent:read",
      auth_source: "oauth",
      client_id: "client-1",
      grant_id: "grant-1",
    });
    expect(payload.sid).toBeUndefined();
  });

  it("refuses a token for another resource and a scope the token lacks", async () => {
    const pipeline = await oauthToken({ sub: "user", scope: "pipeline:catalog", aud: `${PORTAL}/v1/pipeline` });
    const wrongResource = await portal("/v1/agent/sessions", {
      headers: { authorization: `Bearer ${pipeline}` },
    });
    expect(wrongResource.status).toBe(401);
    const readOnly = await oauthToken({ sub: "user", scope: "agent:read", aud: `${PORTAL}/v1/agent` });
    const write = await portal("/v1/agent/chat", {
      method: "POST",
      headers: { authorization: `Bearer ${readOnly}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(403);
    expect(write.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(write.headers.get("www-authenticate")).toContain('scope="agent:write"');
  });

  it("requires Agent write from an OAuth client changing a thread's model or world", async () => {
    const json = { "content-type": "application/json" };
    const readOnly = await oauthToken({ sub: "user", scope: "agent:read", aud: `${PORTAL}/v1/agent` });
    for (const path of ["/api/thread/model", "/api/thread/sim/world"]) {
      const denied = await portal(path, {
        method: "POST",
        headers: { authorization: `Bearer ${readOnly}`, ...json },
        body: "{}",
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("www-authenticate")).toContain('scope="agent:write"');
    }
    expect(seen).toHaveLength(0);
    const write = await oauthToken({ sub: "user", scope: "agent:write", aud: `${PORTAL}/v1/agent` });
    const allowed = await portal("/api/thread/model", {
      method: "POST",
      headers: { authorization: `Bearer ${write}`, ...json },
      body: "{}",
    });
    expect(allowed.status).toBe(200);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ sub: "acct-user", aud: "aomi-backend" });
    // Other backend controls stay closed to OAuth clients.
    const unrelated = await portal("/api/exec/simulate", {
      method: "POST",
      headers: { authorization: `Bearer ${write}`, ...json },
      body: "{}",
    });
    expect(unrelated.status).toBe(401);
  });

  it("holds guests to the resource's guest ceiling", async () => {
    const token = await oauthToken({
      sub: "guest",
      guest: true,
      scope: "agent:read custody:delegate",
      aud: `${PORTAL}/v1/agent`,
    });
    const response = await portal("/v1/agent/sessions", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
  });

  it("lets a registered partner widget call cross-origin, and nobody else", async () => {
    const token = await oauthToken({ sub: "user", scope: "agent:read", aud: `${PORTAL}/v1/agent` });
    const partner = await portal("/v1/agent/sessions", {
      headers: { authorization: `Bearer ${token}` },
      origin: PARTNER,
    });
    expect(partner.status).toBe(200);
    const stranger = await portal("/v1/agent/sessions", {
      headers: { authorization: `Bearer ${token}` },
      origin: "https://stranger.example",
    });
    expect(stranger.status).toBe(401);
  });

  it("requires and verifies a DPoP proof for a DPoP-bound token", async () => {
    const dpopKey = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(dpopKey.publicKey);
    const token = await oauthToken({
      sub: "user",
      scope: "agent:read",
      aud: `${PORTAL}/v1/agent`,
      cnf: { jkt: await calculateJwkThumbprint(publicJwk) },
    });
    const proof = async (htu: string, accessToken = token) =>
      new SignJWT({
        htm: "GET",
        htu,
        jti: crypto.randomUUID(),
        ath: Buffer.from(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken)),
        ).toString("base64url"),
      })
        .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk })
        .setIssuedAt()
        .sign(dpopKey.privateKey);

    const missing = await portal("/v1/agent/sessions", { headers: { authorization: `DPoP ${token}` } });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^DPoP error="invalid_dpop_proof"/);

    const wrongUrl = await portal("/v1/agent/sessions", {
      headers: { authorization: `DPoP ${token}`, dpop: await proof(`${PORTAL}/v1/agent/other`) },
    });
    expect(wrongUrl.status).toBe(401);

    const ok = await portal("/v1/agent/sessions?x=1", {
      headers: { authorization: `DPoP ${token}`, dpop: await proof(`${PORTAL}/v1/agent/sessions`) },
    });
    expect(ok.status).toBe(200);
    expect(seen.at(-1)!.headers.dpop).toBeUndefined();
  });
});

describe("portal surface: MCP", () => {
  it("challenges an anonymous MCP call with the resource metadata and re-authorization scopes", async () => {
    const response = await portal("/v1/agent/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","method":"initialize","id":1}',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${PORTAL}/.well-known/oauth-protected-resource/v1/agent/mcp", scope="mcp:agent agent:read agent:write offline_access"`,
    );
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("refuses a session cookie on MCP and forwards an OAuth grant with every scope it holds", async () => {
    const cookie = await portal("/v1/agent/mcp", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json" },
      origin: PORTAL,
      body: "{}",
    });
    expect(cookie.status).toBe(401);
    const token = await oauthToken({
      sub: "user",
      scope: "mcp:agent agent:read agent:write",
      aud: `${PORTAL}/v1/agent/mcp`,
    });
    const response = await portal("/v1/agent/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
      },
      body: '{"jsonrpc":"2.0","method":"tools/list","id":2}',
    });
    expect(response.status).toBe(200);
    const [upstream] = seen;
    expect(upstream.url).toBe(`${AGENT}/v1/agent/mcp`);
    expect(upstream.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(upstream.body).toBe('{"jsonrpc":"2.0","method":"tools/list","id":2}');
    expect((await upstreamBearer(upstream)).payload).toMatchObject({
      scope: "mcp:agent agent:read agent:write",
      resource: `${PORTAL}/v1/agent/mcp`,
    });
  });
});

describe("portal surface: backend /api allowlist, payment and public routes", () => {
  it("forwards allowlisted /api routes to the backend pool with an account bearer", async () => {
    const response = await portal("/api/thread/apps", { headers: { cookie: "session=user" }, origin: PORTAL });
    expect(response.status).toBe(200);
    const [upstream] = seen;
    expect(upstream.url).toBe(`${BACKEND}/api/thread/apps?platform=web&platform=telegram`);
    expect((await upstreamBearer(upstream)).payload).toMatchObject({
      sub: "acct-user",
      aud: "aomi-backend",
      role: "user",
    });
  });

  it("sends the manager-owned control-plane routes to MANAGER_ORIGIN once it is set", async () => {
    const unset = await portal("/api/account/bots", { headers: { cookie: "session=user" }, origin: PORTAL });
    expect(unset.status).toBe(200);
    expect(seen[0].url).toBe(`${BACKEND}/api/account/bots`);
    seen = [];
    const bots = await portal("/api/account/bots", {
      headers: { cookie: "session=user" },
      origin: PORTAL,
      env: { MANAGER_ORIGIN: MANAGER },
    });
    expect(bots.status).toBe(200);
    expect(seen[0].url).toBe(`${MANAGER}/api/account/bots`);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ sub: "acct-user", aud: "aomi-backend" });
    // The rest of /api/account and the chat routes stay on the backend pool.
    const settings = await portal("/api/account", {
      headers: { cookie: "session=user" },
      origin: PORTAL,
      env: { MANAGER_ORIGIN: MANAGER },
    });
    expect(settings.status).toBe(200);
    expect(seen[1].url).toBe(`${BACKEND}/api/account`);
  });

  it("mints the browser's raw backend bearer as aomi-edge for the portal's own sessions only", async () => {
    const response = await portal("/v1/account/bearer", { headers: { cookie: "session=user" }, origin: PORTAL });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { bearer: string; expires_at: number };
    const { payload, protectedHeader } = await jwtVerify(body.bearer, edgePublicKey, { issuer: "aomi-edge" });
    expect(payload).toMatchObject({ sub: "acct-user", aud: "aomi-backend", role: "user" });
    expect(protectedHeader.kid).toBe("aomi-edge-dev-1");
    expect(body.expires_at).toBe(payload.exp);
    expect(seen).toHaveLength(0);

    // Any https site may embed the widget, so an embedded session never gets a raw token.
    const widget = await portal("/v1/account/bearer", {
      headers: { authorization: "Bearer aomi_wst_user" },
      origin: PARTNER,
    });
    expect(widget.status).toBe(403);
    expect(await widget.json()).toEqual({ error: "insufficient_scope" });
    const oauth = await portal("/v1/account/bearer", {
      headers: { authorization: `Bearer ${await oauthToken({ sub: "user", scope: "agent:read", aud: AGENT })}` },
    });
    expect(oauth.status).toBe(401);
    expect(await portal("/v1/account/bearer", { method: "POST", origin: PORTAL })).toMatchObject({ status: 404 });
  });

  it("serves anonymous chat catalog reads without a bearer and keeps settings from guests", async () => {
    const models = await portal("/api/thread/models");
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual(["gpt", 3, "claude"]);
    const apps = await portal("/api/thread/apps", { origin: PARTNER });
    expect(apps.status).toBe(200);
    expect(seen[0].headers.authorization).toBeUndefined();
    const settings = await portal("/api/account", { headers: { cookie: "session=guest" }, origin: PORTAL });
    expect(settings.status).toBe(403);
    expect(await settings.json()).toEqual({ error: "insufficient_scope" });
    const anonymousSettings = await portal("/api/secrets");
    expect(anonymousSettings.status).toBe(401);
  });

  it("answers 404 for an /api method the allowlist does not name and passes unknown paths to Vercel", async () => {
    const wrongMethod = await portal("/api/thread/models", { method: "POST" });
    expect(wrongMethod.status).toBe(404);
    const vercel = await portal("/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json" },
      body: "{}",
    });
    expect(vercel.status).toBe(200);
    const body = (await vercel.json()) as Seen & { tag: string };
    expect(body.tag).toBe("vercel");
    expect(body.url).toBe(`${UPSTREAM}/api/auth/sign-in/anonymous`);
    expect(body.headers.cookie).toBe("session=user");
    expect(body.headers["x-forwarded-host"]).toBe("portal.example");
    // The portal's own Set-Cookie reaches the browser untouched.
    expect(vercel.headers.get("set-cookie")).toBe("nope=1");
  });

  it("mints payment-audience bearers for credits and funding events", async () => {
    const read = await portal("/v1/account/credits", { headers: { cookie: "session=user" }, origin: PORTAL });
    expect(read.status).toBe(200);
    expect(seen[0].url).toBe(`${PAYMENT}/v1/account/credits`);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({
      aud: "aomi-payment",
      scope: "account:credits:read",
    });
    const fund = await portal("/v1/account/credits/funding-events", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json", "payment-signature": "sig" },
      origin: PORTAL,
      body: "{}",
    });
    expect(fund.status).toBe(200);
    expect((await upstreamBearer(seen[1])).payload.scope).toBe("account:credits:fund payments:submit");
    expect(seen[1].headers["payment-signature"]).toBe("sig");
  });

  it("serves discovery and the public catalog credential-free", async () => {
    const catalog = await portal("/.well-known/api-catalog", { headers: { cookie: "session=user" } });
    expect(catalog.status).toBe(200);
    expect(seen[0].url).toBe(`${AGENT}/.well-known/api-catalog`);
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(catalog.headers.get("access-control-allow-origin")).toBe("*");

    const models = await portal("/api/public/catalog/models?application_id=9");
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual(["gpt", "claude"]);
    expect(models.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(models.headers.get("cdn-cache-control")).toContain("max-age=1800");
    expect(models.headers.get("access-control-allow-origin")).toBe("*");
    expect(await (await portal("/api/public/catalog/secrets")).json()).toEqual({ error: "not_found" });

    // A redirecting backend is unavailable; the edge never follows it, and
    // workerd offers no "error" redirect mode to refuse it with.
    const redirected = await portal("/api/public/catalog/skills");
    expect(redirected.status).toBe(502);
    expect(await redirected.json()).toEqual({ error: "catalog_unavailable" });
  });

  it("answers preflight for moved routes without credentials", async () => {
    const response = await portal("/v1/agent/chat", {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
      origin: PARTNER,
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(PARTNER);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toContain("Payment-Signature");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("reports the portal as unavailable rather than guessing when the principal exchange fails", async () => {
    const broken: FetchLike = async (request) => {
      if (new URL(request.url).pathname === "/api/auth/edge/principal") return new Response("boom", { status: 500 });
      return world(request);
    };
    const response = await handleRequest(
      new Request(`${PORTAL}/v1/agent/sessions`, { headers: { cookie: "session=user", origin: PORTAL } }),
      env,
      broken,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "auth_unavailable" });
  });
});

describe("portal surface: host selection", () => {
  it("leaves api hosts on the routing core", async () => {
    const response = await handleRequest(
      new Request("https://api-staging.aomi.dev/api/thread/models", { headers: { cookie: "session=user" } }),
      { ...env, BACKEND_ORIGINS: BACKEND },
      world,
    );
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(0);
    expect(principalCalls).toBe(0);
  });

  it("decodes nothing it did not mint: the upstream bearer is a fresh edge JWT per request", async () => {
    await portal("/v1/agent/sessions", { headers: { cookie: "session=user" }, origin: PORTAL });
    const first = decodeJwt(seen[0].headers.authorization.slice(7));
    expect(first.iss).toBe("aomi-edge");
  });
});
