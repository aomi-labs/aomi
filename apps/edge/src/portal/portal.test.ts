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
import type { FetchLike } from "../kernel/proxy";
import { resetJwksCache } from "./jwks";
import { resetPrincipalCaches } from "./principal";
import { resetBudgets } from "./routes";

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
  if (url.origin === MANAGER) return echo(request, body, "manager");
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
  resetBudgets();
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

  it("mints only the scope a write needs (never custody:delegate) and refuses a guest's paid write", async () => {
    await portal("/v1/agent/chat", {
      method: "POST",
      headers: { cookie: "session=user", "content-type": "application/json" },
      origin: PORTAL,
      body: "{}",
    });
    expect((await upstreamBearer(seen[0])).payload.scope).toBe("agent:write");
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
    // A widget-started chat is the widget's, never the portal's (its lane may be Instant).
    expect(payload).toMatchObject({ sub: "acct-widget", auth_source: "widget", scope: "agent:write" });
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

    it("requires Agent write and rejects another resource without forwarding", async () => {
      for (const grant of [
        { scope: "agent:read", aud: `${PORTAL}/v1/agent`, status: 403 },
        { scope: "agent:write", aud: `${PORTAL}/v1/pipeline`, status: 401 },
      ]) {
        const token = await oauthToken({ sub: "user", ...grant });
        const response = await portal(path, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
        expect(response.status).toBe(grant.status);
      }
      expect(seen).toHaveLength(0);
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

  it("does not extend Agent grants to unrelated backend controls", async () => {
    const token = await oauthToken({ sub: "user", scope: "agent:write", aud: `${PORTAL}/v1/agent` });
    const response = await portal("/api/exec/simulate", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("verifies an access token against the portal JWKS and forwards an oauth-sourced bearer", async () => {
    const token = await oauthToken({
      sub: "user",
      scope: "agent:read agent:write",
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

  it("holds guests to the resource's guest ceiling", async () => {
    const token = await oauthToken({
      sub: "guest",
      guest: true,
      scope: "agent:read payments:submit",
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
  it("sends the manager's control-plane routes to MANAGER_ORIGIN, still as the signed-in account", async () => {
    const withManager = { ...env, MANAGER_ORIGIN: MANAGER };
    const call = (path: string) =>
      handleRequest(
        new Request(`${PORTAL}${path}`, { headers: { cookie: "session=user", origin: PORTAL } }),
        withManager,
        world,
      );
    expect((await call("/api/account/bots")).status).toBe(200);
    expect((await call("/api/integrations/github-app/oauth/start")).status).toBe(200);
    expect((await call("/api/account")).status).toBe(200);
    expect(seen.map((record) => record.url)).toEqual([
      `${MANAGER}/api/account/bots`,
      `${MANAGER}/api/integrations/github-app/oauth/start`,
      `${BACKEND}/api/account`,
    ]);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ sub: "acct-user", aud: "aomi-backend" });
    expect(seen[0].headers.cookie).toBeUndefined();
  });

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

/** Callers by name: how each one presents itself to the edge. */
async function caller(name: string): Promise<{ headers: Record<string, string>; origin?: string }> {
  switch (name) {
    case "portal user":
      return { headers: { cookie: "session=user" }, origin: PORTAL };
    case "portal guest":
      return { headers: { cookie: "session=guest" }, origin: PORTAL };
    case "CLI session":
      return { headers: { authorization: "Bearer user" } };
    case "widget user":
      return { headers: { authorization: "Bearer aomi_wst_user" }, origin: PARTNER };
    case "widget guest":
      return { headers: { authorization: "Bearer aomi_wst_guest" }, origin: PARTNER };
    case "OAuth user":
      return { headers: { authorization: `Bearer ${await oauthToken({ sub: "user", scope: "agent:read agent:write", aud: `${PORTAL}/v1/agent` })}` } };
    case "OAuth guest":
      return { headers: { authorization: `Bearer ${await oauthToken({ sub: "guest", guest: true, scope: "agent:read agent:write", aud: `${PORTAL}/v1/agent` })}` } };
    default:
      throw new Error(name);
  }
}

async function call(name: string, method: string, path: string) {
  const { headers, origin } = await caller(name);
  const body = method === "GET" ? undefined : "{}";
  return portal(path, { method, origin, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body });
}

describe("portal surface: the backend bearer says who is calling", () => {
  it.each([
    ["portal user", { auth_source: "session", principal_class: "user" }],
    ["portal guest", { auth_source: "session", principal_class: "guest" }],
    ["CLI session", { auth_source: "cli_session", principal_class: "user" }],
    ["widget user", { auth_source: "widget", principal_class: "user" }],
    ["widget guest", { auth_source: "widget", principal_class: "guest" }],
    ["OAuth user", { auth_source: "oauth", principal_class: "user", client_id: "client-1" }],
  ])("%s", async (name, claims) => {
    const response = await call(name, "GET", "/v1/commits/c-1");
    expect(response.status).toBe(200);
    expect(seen[0].url).toBe(`${BACKEND}/v1/commits/c-1`);
    const { payload } = await upstreamBearer(seen[0]);
    expect(payload).toMatchObject({ aud: "aomi-backend", role: "user", ...claims });
    // No scope: the backend reads a scope-less aomi-edge bearer as first-party by its auth_source.
    expect(payload.scope).toBeUndefined();
    if (!("client_id" in claims)) expect(payload.client_id).toBeUndefined();
  });

  it("names the widget on the agent API too, so its chats are never recorded as portal chats", async () => {
    await call("widget user", "GET", "/v1/agent/sessions");
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ aud: "aomi-api-server", auth_source: "widget" });
    await call("CLI session", "GET", "/v1/agent/sessions");
    expect((await upstreamBearer(seen[1])).payload).toMatchObject({ auth_source: "cli_session" });
  });
});

describe("portal surface: wallets, agent wallets and connection lanes", () => {
  const READS = ["/v1/account/wallets", "/v1/account/agent-wallets", "/v1/account/agent-wallets/g-1/balances"];
  const WRITES = [
    ["POST", "/v1/account/agent-wallets"],
    ["PATCH", "/v1/account/agent-wallets/g-1"],
    ["POST", "/v1/account/agent-wallets/g-1/withdraw"],
    ["PUT", "/v1/account/pause-all"],
    ["PUT", "/v1/account/connection-settings/portal"],
    ["PUT", "/v1/account/connections/oauth%3Acodex/wallets"],
    ["POST", "/v1/account/link/telegram/preview"],
    ["POST", "/v1/account/link/telegram/confirm"],
    ["POST", "/v1/account/link/telegram/cancel"],
  ] as const;

  it.each(READS)("reads %s from the backend for any session and an OAuth agent:read grant", async (path) => {
    for (const name of ["portal user", "widget user", "CLI session", "OAuth user"]) {
      expect((await call(name, "GET", path)).status).toBe(200);
    }
    expect(seen.map((record) => record.url)).toEqual(Array(4).fill(`${BACKEND}${path}`));
    expect(seen.every((record) => record.headers.cookie === undefined)).toBe(true);
    const readOnly = await oauthToken({ sub: "user", scope: "agent:write", aud: `${PORTAL}/v1/agent` });
    const refused = await portal(path, { headers: { authorization: `Bearer ${readOnly}` } });
    expect(refused.status).toBe(403);
    expect(seen).toHaveLength(4);
  });

  it.each(WRITES)("lets only a signed-in portal session %s %s", async (method, path) => {
    const ok = await call("portal user", method, path);
    expect(ok.status).toBe(200);
    expect(seen[0]).toMatchObject({ url: `${BACKEND}${path}`, method });
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ auth_source: "session", principal_class: "user" });
    for (const name of ["portal guest", "CLI session", "widget user", "widget guest"]) {
      const refused = await call(name, method, path);
      expect([name, refused.status, await refused.json()]).toEqual([name, 403, { error: "portal_session_required" }]);
    }
    // An OAuth grant never reaches a portal-only write.
    expect((await call("OAuth user", method, path)).status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it("refuses a cross-site cookie write before forwarding", async () => {
    const response = await portal("/v1/account/pause-all", {
      method: "PUT",
      headers: { cookie: "session=user", "content-type": "application/json" },
      origin: "https://evil.example",
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ["POST", "/v1/account/wallets"],
    ["PATCH", "/v1/account/agent-wallets"],
    ["POST", "/v1/account/agent-wallets/g-1"],
    ["GET", "/v1/account/agent-wallets/g-1/withdraw"],
    ["GET", "/v1/account/connections/portal/wallets"],
    ["GET", "/v1/account/pause-all"],
    ["GET", "/v1/account/link/telegram/confirm"],
  ] as const)("answers %s %s with 404 before identifying the caller", async (method, path) => {
    const response = await call("portal user", method, path);
    expect(response.status).toBe(404);
    expect(seen).toHaveLength(0);
    expect(principalCalls).toBe(0);
  });

  it("budgets link attempts per account and action", async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await call("portal user", "POST", "/v1/account/link/telegram/confirm")).status).toBe(200);
    const over = await call("portal user", "POST", "/v1/account/link/telegram/confirm");
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited" });
    expect(seen).toHaveLength(5);
    // Preview has its own, larger budget.
    expect((await call("portal user", "POST", "/v1/account/link/telegram/preview")).status).toBe(200);
  });

  it("leaves the connections list and disconnects on the portal (the account graph)", async () => {
    for (const [method, path] of [
      ["GET", "/v1/account/connections"],
      ["DELETE", "/v1/account/connections/oauth/client-1"],
      ["DELETE", "/v1/account/connections/telegram"],
      ["PATCH", "/v1/account/wallets/w-1"],
    ] as const) {
      const response = await call("portal user", method, path);
      expect(((await response.json()) as { tag: string; url: string })).toMatchObject({ tag: "vercel", url: `${UPSTREAM}${path}` });
    }
  });

  it("lets a CLI or OAuth login switch its own thread's wallet with agent:write", async () => {
    for (const name of ["portal user", "CLI session", "OAuth user"])
      expect((await call(name, "PUT", "/api/thread/wallet")).status).toBe(200);
    const readOnly = await oauthToken({ sub: "user", scope: "agent:read", aud: `${PORTAL}/v1/agent` });
    const refused = await portal("/api/thread/wallet", { method: "PUT", headers: { authorization: `Bearer ${readOnly}` }, body: "{}" });
    expect(refused.status).toBe(403);
    expect(seen).toHaveLength(3);
  });
});

describe("portal surface: thread-less commits", () => {
  it.each([
    "/v1/commits/c-1/sign",
    "/v1/commits/c-1/broadcast",
    "/v1/commits/c-1/attempts",
    "/v1/commits/c-1/attempts/a-1/report",
    "/v1/commits/c-1/reject",
  ])("forwards POST %s with agent:write", async (path) => {
    expect((await call("widget user", "POST", path)).status).toBe(200);
    expect(seen[0].url).toBe(`${BACKEND}${path}`);
    const readOnly = await oauthToken({ sub: "user", scope: "agent:read", aud: `${PORTAL}/v1/agent` });
    expect((await portal(path, { method: "POST", headers: { authorization: `Bearer ${readOnly}` }, body: "{}" })).status).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it.each(["portal user", "CLI session", "OAuth user"])("lets a %s approve", async (name) => {
    expect((await call(name, "POST", "/v1/commits/c-1/approve")).status).toBe(200);
    expect(seen[0].url).toBe(`${BACKEND}/v1/commits/c-1/approve`);
  });

  it.each(["portal guest", "widget user", "widget guest", "OAuth guest"])("never lets a %s approve", async (name) => {
    const response = await call(name, "POST", "/v1/commits/c-1/approve");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "commit_approval_forbidden", status: 403 });
    expect(seen).toHaveLength(0);
  });

  it("requires a principal and knows no other actions", async () => {
    expect((await portal("/v1/commits/c-1")).status).toBe(401);
    expect((await call("portal user", "POST", "/v1/commits/c-1")).status).toBe(404);
    expect((await call("portal user", "GET", "/v1/commits/c-1/approve")).status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});

describe("portal surface: the /v1 sign-in and app-locked MCP", () => {
  it("takes a /v1 token on REST, narrowed to the route's scopes, and never on MCP", async () => {
    const token = await oauthToken({
      sub: "user",
      scope: "agent:read pipeline:catalog account:apps:read offline_access",
      aud: `${PORTAL}/v1`,
    });
    const headers = { authorization: `Bearer ${token}` };
    expect((await portal("/v1/agent/sessions", { headers })).status).toBe(200);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({ scope: "agent:read", resource: `${PORTAL}/v1/agent` });
    expect((await portal("/v1/account/apps", { headers })).status).toBe(200);
    expect((await upstreamBearer(seen[1])).payload).toMatchObject({ scope: "account:apps:read", resource: `${PORTAL}/v1/account` });
    expect((await portal("/v1/account/wallets", { headers })).status).toBe(200);
    // A scope the token lacks is still refused.
    expect((await portal("/v1/agent/chat", { method: "POST", headers, body: "{}" })).status).toBe(403);
    const mcp = await portal("/v1/agent/mcp", { method: "POST", headers, body: "{}" });
    expect(mcp.status).toBe(401);
    expect(seen).toHaveLength(3);
  });

  it("holds a /v1 guest token to the route's own guest ceiling", async () => {
    const token = await oauthToken({ sub: "guest", guest: true, scope: "agent:read account:apps:read", aud: `${PORTAL}/v1` });
    // On /v1/agent the account scope is dropped, so the guest reads.
    expect((await portal("/v1/agent/sessions", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    // On /v1/account it is kept, and a guest may not carry it.
    expect((await portal("/v1/account/apps", { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  });

  it("forwards an app MCP grant for exactly its own path with every scope it holds", async () => {
    const token = await oauthToken({ sub: "user", scope: "mcp:agent agent:read", aud: `${PORTAL}/v1/apps/hoodit/mcp` });
    const response = await portal("/v1/apps/hoodit/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","method":"tools/list","id":1}',
    });
    expect(response.status).toBe(200);
    expect(seen[0].url).toBe(`${AGENT}/v1/apps/hoodit/mcp`);
    expect((await upstreamBearer(seen[0])).payload).toMatchObject({
      scope: "mcp:agent agent:read",
      resource: `${PORTAL}/v1/apps/hoodit/mcp`,
      auth_source: "oauth",
    });
  });

  it("locks app MCP to its own path: another resource's token and bad names fail", async () => {
    for (const aud of [`${PORTAL}/v1/agent/mcp`, `${PORTAL}/v1/apps/other/mcp`, `${PORTAL}/v1`]) {
      const token = await oauthToken({ sub: "user", scope: "mcp:agent agent:read", aud });
      const response = await portal("/v1/apps/hoodit/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
      expect(response.status).toBe(401);
    }
    const anonymous = await portal("/v1/apps/hoodit/mcp", { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${PORTAL}/.well-known/oauth-protected-resource/v1/apps/hoodit/mcp", scope="mcp:agent agent:read agent:write offline_access"`,
    );
    const badName = await portal("/v1/apps/Bad.App/mcp", { method: "POST", body: "{}" });
    expect(badName.status).toBe(404);
    expect(await badName.json()).toEqual({ error: "app_not_found" });
    expect(seen).toHaveLength(0);
  });
});

describe("portal surface: removed routes", () => {
  it.each([
    ["POST", "/api/delegation/privy/begin"],
    ["POST", "/api/delegation/para/begin"],
    ["GET", "/api/widget/v1/execution-profile"],
    ["PUT", "/api/widget/v1/aa-accounts/8453"],
    ["POST", "/api/widget/v1/signing-requests/sign%3Aabc"],
  ] as const)("no longer serves %s %s at the edge", async (method, path) => {
    const response = await call("portal user", method, path);
    expect(((await response.json()) as { tag: string }).tag).toBe("vercel");
    expect(seen.every((record) => !record.url.startsWith(BACKEND))).toBe(true);
  });
});
