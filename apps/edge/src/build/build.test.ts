// @vitest-environment node
import { createHash } from "node:crypto";

import { SignJWT, decodeJwt, importSPKI, jwtVerify, type KeyLike } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { handleRequest } from "../handler";
import { resetEdgeServices } from "../identity";
import type { FetchLike } from "../kernel/proxy";

const BUILD = "https://build.example";
const UPSTREAM = "https://build-vercel.example";
const BACKEND = "https://backend.example";
const PAYMENT = "https://payment.example";
const SECRET = "build-session-secret-for-tests";

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
  BUILD_HOSTS: "build.example",
  BUILD_UPSTREAM_ORIGIN: UPSTREAM,
  BUILD_SESSION_SECRET: SECRET,
  BACKEND_ORIGINS: BACKEND,
  API_SERVER_ORIGIN: "https://agent.example",
  PAYMENT_ORIGIN: PAYMENT,
  APP_DEPLOY_PLATFORMS: "web,telegram",
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
let seen: Seen[];
let exchangeStatus: number;
let claimOwner: string;
let edgePublicKey: KeyLike;

function record(request: Request, body: string): Seen {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => (headers[name] = value));
  const entry = { url: request.url, method: request.method, headers, body };
  seen.push(entry);
  return entry;
}

/** The Vercel Build app, the Manager (on the backend origin) and the payment service, faked. */
const world: FetchLike = async (request) => {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const entry = record(request, body);
  if (url.origin === BACKEND) {
    if (url.pathname === "/api/integrations/github-app/oauth/exchange") {
      if (exchangeStatus !== 200) return Response.json({ ok: false, error: "nope" }, { status: exchangeStatus });
      return Response.json({
        github_user_id: "4242",
        github_login: "octocat",
        installation_id: 99,
        visibility_grant: `grant-for-${url.searchParams.get("code")}`,
      });
    }
    if (url.pathname === "/api/integrations/github-app/oauth/claim")
      return Response.json({ github_user_id: claimOwner, project: { id: 7, platform_name: "web" } });
    return Response.json({ tag: "backend", ...entry });
  }
  if (url.origin === PAYMENT) return Response.json({ tag: "payment", ...entry });
  if (url.origin === UPSTREAM) return Response.json({ tag: "vercel", ...entry }, { headers: { "set-cookie": "vercel=1" } });
  return new Response("unexpected origin", { status: 599 });
};

function build(path: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return handleRequest(new Request(`${BUILD}${path}`, { ...init, headers }), env, world);
}

function cookiesOf(response: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), raw };
  }
  return out;
}

async function signedIn(): Promise<string> {
  const login = await build("/api/bff/auth/github/login");
  const oauthCookie = cookiesOf(login).aomi_github_oauth_request.value;
  const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
  const callback = await build(`/api/bff/auth/github/callback?code=c1&state=${state}`, {
    headers: { cookie: `aomi_github_oauth_request=${oauthCookie}` },
  });
  return `aomi_github=${cookiesOf(callback).aomi_github.value}`;
}

async function bearerOf(entry: Seen) {
  const token = entry.headers.authorization?.replace(/^Bearer /, "") ?? "";
  return (await jwtVerify(token, edgePublicKey, { issuer: "aomi-edge" })).payload;
}

beforeAll(async () => {
  edgePublicKey = await importSPKI(DEV_PUBLIC_KEY, "EdDSA");
});

beforeEach(() => {
  seen = [];
  exchangeStatus = 200;
  claimOwner = "4242";
  resetEdgeServices();
});

describe("build surface: GitHub sign-in", () => {
  it("starts OAuth at GitHub with the staging app and a signed request cookie", async () => {
    const response = await build("/api/bff/auth/github/login?resume=template&platform=web");
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("Iv23lilgvJz13pJekLSZ");
    expect(location.searchParams.get("redirect_uri")).toBe(`${BUILD}/api/bff/auth/github/callback`);
    const cookie = cookiesOf(response).aomi_github_oauth_request;
    expect(cookie.raw).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    expect(decodeJwt(cookie.value)).toMatchObject({
      kind: "github_oauth_request",
      aud: "aomi-build-github-oauth-request",
      oauthState: location.searchParams.get("state"),
      continuation: { kind: "template", platform: "web" },
    });
    expect(seen).toEqual([]);
  });

  it("rejects an invalid template platform and a wrong method", async () => {
    expect((await build("/api/bff/auth/github/login?resume=template&platform=bad/one")).status).toBe(400);
    const wrong = await build("/api/bff/auth/github/login", { method: "POST" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
  });

  it("exchanges the code as the aomi-edge service and sets the session cookies", async () => {
    const login = await build("/api/bff/auth/github/login");
    const oauthCookie = cookiesOf(login).aomi_github_oauth_request.value;
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const response = await build(`/api/bff/auth/github/callback?code=c1&state=${state}`, {
      headers: { cookie: `aomi_github_oauth_request=${oauthCookie}` },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${BUILD}/operate/deployments?launch=github`);

    const [exchange] = seen;
    const exchangeUrl = new URL(exchange.url);
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe(`${BACKEND}/api/integrations/github-app/oauth/exchange`);
    expect(Object.fromEntries(exchangeUrl.searchParams)).toEqual({
      code: "c1",
      app: "2",
      redirect_uri: `${BUILD}/api/bff/auth/github/callback`,
    });
    expect(exchange.headers.cookie).toBeUndefined();
    expect(await bearerOf(exchange)).toMatchObject({ role: "service", sub: "aomi-edge", aud: "aomi-backend" });

    const cookies = cookiesOf(response);
    expect(cookies.aomi_github_oauth_request.raw).toMatch(/Max-Age=0/);
    expect(cookies.aomi_github.raw).toMatch(/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
    expect(cookies.aomi_github_visibility).toMatchObject({ value: "grant-for-c1" });
    expect(cookies.aomi_github_visibility.raw).toMatch(/Max-Age=600/);
    const session = await jwtVerify(cookies.aomi_github.value, new TextEncoder().encode(SECRET));
    expect(session.payload).toMatchObject({ sub: "4242", login: "octocat", installationId: "99" });
    expect(session.payload.exp! - session.payload.iat!).toBe(7 * 24 * 60 * 60);
  });

  it("sends the browser back with an error when the state or the exchange fails", async () => {
    const stale = await build("/api/bff/auth/github/callback?code=c1&state=x");
    expect(stale.headers.get("location")).toBe(`${BUILD}/operate/deployments?launch=github&github_error=invalid_oauth_state`);

    exchangeStatus = 403;
    const login = await build("/api/bff/auth/github/login");
    const oauthCookie = cookiesOf(login).aomi_github_oauth_request.value;
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const forbidden = await build(`/api/bff/auth/github/callback?code=c1&state=${state}`, {
      headers: { cookie: `aomi_github_oauth_request=${oauthCookie}` },
    });
    expect(new URL(forbidden.headers.get("location")!).searchParams.get("github_error")).toBe("service_auth_forbidden");
    expect(cookiesOf(forbidden).aomi_github).toBeUndefined();
  });

  it("reports the session and signs it out", async () => {
    const anonymous = await (await build("/api/bff/auth/github/status")).json();
    expect(anonymous).toEqual({ signedIn: false, githubLogin: null, githubAvatarUrl: null, installationId: null });

    const cookie = await signedIn();
    expect(await (await build("/api/bff/auth/github/status", { headers: { cookie } })).json()).toEqual({
      signedIn: true,
      githubLogin: "octocat",
      githubAvatarUrl: "https://avatars.githubusercontent.com/u/4242?s=96&v=4",
      installationId: "99",
    });

    const signout = await build("/api/bff/auth/github/signout", { method: "POST", headers: { cookie } });
    expect(await signout.json()).toEqual({ ok: true });
    expect(cookiesOf(signout).aomi_github.raw).toMatch(/^aomi_github=; .*Max-Age=0/);
  });

  it("accepts a session cookie the Vercel Build BFF issued with the same secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ login: "hubot", installationId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("77")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(SECRET));
    const status = await build("/api/bff/auth/github/status", { headers: { cookie: `aomi_github=${token}` } });
    expect(await status.json()).toMatchObject({ signedIn: true, githubLogin: "hubot", installationId: null });
  });
});

describe("build surface: claim", () => {
  it("needs a session and a project, then binds the project to the same GitHub user", async () => {
    expect((await build("/api/bff/auth/github/claim?projectId=7")).status).toBe(401);
    const cookie = await signedIn();
    expect((await build("/api/bff/auth/github/claim?projectId=-1", { headers: { cookie } })).status).toBe(400);

    const start = await build("/api/bff/auth/github/claim?projectId=7", { headers: { cookie } });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const oauthCookie = cookiesOf(start).aomi_github_oauth_request.value;
    seen = [];
    const done = await build(`/api/bff/auth/github/callback?code=c2&state=${state}`, {
      headers: { cookie: `${cookie}; aomi_github_oauth_request=${oauthCookie}` },
    });
    expect(done.headers.get("location")).toBe(`${BUILD}/projects/7?claim=success`);
    const [claim] = seen;
    expect(claim.url).toBe(`${BACKEND}/api/integrations/github-app/oauth/claim`);
    expect(JSON.parse(claim.body)).toEqual({
      code: "c2",
      project_id: 7,
      redirect_uri: `${BUILD}/api/bff/auth/github/callback`,
    });
    expect(await bearerOf(claim)).toMatchObject({ role: "service", sub: "aomi-edge" });

    claimOwner = "1";
    const changed = await build(`/api/bff/auth/github/callback?code=c2&state=${state}`, {
      headers: { cookie: `${cookie}; aomi_github_oauth_request=${oauthCookie}` },
    });
    expect(new URL(changed.headers.get("location")!).searchParams.get("github_error")).toBe("github_account_changed");
  });
});

describe("build surface: CLI login", () => {
  const LOOPBACK = "http://127.0.0.1:4321/callback";
  const STATE = "s".repeat(40);
  const VERIFIER = "v".repeat(64);
  const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
  const cliLogin = `/api/bff/cli/login?redirect_uri=${encodeURIComponent(LOOPBACK)}&state=${STATE}&code_challenge=${CHALLENGE}`;

  it("rejects a non-loopback redirect", async () => {
    const bad = await build(
      `/api/bff/cli/login?redirect_uri=${encodeURIComponent("https://evil.example/callback")}&state=${STATE}&code_challenge=${CHALLENGE}`,
    );
    expect(bad.status).toBe(400);
  });

  it("authorizes a signed-in browser and exchanges the loopback code for a one-day bearer", async () => {
    const cookie = await signedIn();
    const authorized = await build(cliLogin, { headers: { cookie } });
    expect(authorized.status).toBe(302);
    const loopback = new URL(authorized.headers.get("location")!);
    expect(loopback.origin + loopback.pathname).toBe(LOOPBACK);
    expect(loopback.searchParams.get("state")).toBe(STATE);
    const code = loopback.searchParams.get("code")!;

    const wrong = await build("/api/bff/cli/exchange", {
      method: "POST",
      body: JSON.stringify({ code, codeVerifier: "w".repeat(64) }),
    });
    expect(wrong.status).toBe(401);

    const exchanged = await build("/api/bff/cli/exchange", {
      method: "POST",
      body: JSON.stringify({ code, codeVerifier: VERIFIER }),
    });
    expect(exchanged.status).toBe(200);
    const body = await exchanged.json();
    expect(body).toMatchObject({ tokenType: "Bearer", expiresIn: 86400, githubLogin: "octocat", githubUserId: "4242" });
    const claims = decodeJwt(body.accessToken);
    expect(claims).toMatchObject({
      sub: "4242",
      aud: "aomi-build-cli",
      kind: "cli_session",
      scopes: ["deploy", "deployment:read", "activate"],
    });
    expect(claims.exp! - claims.iat!).toBe(86400);

    const status = await build("/api/bff/cli/status", { headers: { authorization: `Bearer ${body.accessToken}` } });
    expect(await status.json()).toEqual({ signedIn: true, githubLogin: "octocat", githubUserId: "4242" });
    expect((await build("/api/bff/cli/status")).status).toBe(401);
  });

  it("sends a signed-out browser through GitHub and resumes the loopback continuation", async () => {
    const start = await build(cliLogin);
    const location = new URL(start.headers.get("location")!);
    expect(location.hostname).toBe("github.com");
    const oauthCookie = cookiesOf(start).aomi_github_oauth_request.value;
    expect(decodeJwt(oauthCookie).continuation).toEqual({
      kind: "cli",
      redirectUri: LOOPBACK,
      state: STATE,
      codeChallenge: CHALLENGE,
    });
    const done = await build(`/api/bff/auth/github/callback?code=c3&state=${location.searchParams.get("state")}`, {
      headers: { cookie: `aomi_github_oauth_request=${oauthCookie}` },
    });
    const loopback = new URL(done.headers.get("location")!);
    expect(loopback.origin + loopback.pathname).toBe(LOOPBACK);
    expect(loopback.searchParams.get("code")).toBeTruthy();
    expect(cookiesOf(done).aomi_github).toBeDefined();

    exchangeStatus = 500;
    const failed = await build(`/api/bff/auth/github/callback?code=c3&state=${location.searchParams.get("state")}`, {
      headers: { cookie: `aomi_github_oauth_request=${oauthCookie}` },
    });
    const failedLoopback = new URL(failed.headers.get("location")!);
    expect(failedLoopback.searchParams.get("error")).toBe("exchange_failed");
    expect(failedLoopback.searchParams.get("state")).toBe(STATE);
  });
});

describe("build surface: builder credits", () => {
  it("mints a payment bearer for the GitHub user and forwards to the payment service", async () => {
    const cookie = await signedIn();
    seen = [];
    const response = await build("/v1/builder/credits/ledger?limit=5", { headers: { cookie } });
    expect(response.status).toBe(200);
    const [payment] = seen;
    expect(payment.url).toBe(`${PAYMENT}/v1/builder/credits/ledger?limit=5`);
    expect(payment.headers.cookie).toBeUndefined();
    expect(await bearerOf(payment)).toMatchObject({
      role: "user",
      sub: "4242",
      aud: "aomi-payment",
      scope: "builder:credits:read",
      resource: `${BUILD}/v1/builder`,
      principal_class: "user",
      auth_source: "session",
      sid: "session-bound",
    });
  });

  it("adds payments:submit on a signed funding write and enforces CSRF and sign-in", async () => {
    const cookie = await signedIn();
    expect((await build("/v1/builder/credits/ledger")).status).toBe(401);
    expect((await build("/v1/builder/credits/unknown", { headers: { cookie } })).status).toBe(404);
    const crossSite = await build("/v1/builder/credits/funding-events", {
      method: "POST",
      headers: { cookie },
      origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);

    seen = [];
    const funded = await build("/v1/builder/credits/funding-events", {
      method: "POST",
      headers: { cookie, "payment-signature": "sig", "content-type": "application/json" },
      body: JSON.stringify({ amount: "1" }),
      origin: BUILD,
    });
    expect(funded.status).toBe(200);
    expect((await bearerOf(seen[0])).scope).toBe("builder:credits:fund payments:submit");
    expect(seen[0].headers["payment-signature"]).toBe("sig");
    expect(seen[0].body).toBe(JSON.stringify({ amount: "1" }));
  });
});

describe("build surface: install start and passthrough", () => {
  it("forwards the GitHub App install start anonymously with the default platform", async () => {
    const response = await build("/api/integrations/github-app/oauth/start?repo=x", {
      headers: { cookie: "aomi_github=whatever" },
    });
    expect(response.status).toBe(200);
    const [backend] = seen;
    const url = new URL(backend.url);
    expect(url.origin + url.pathname).toBe(`${BACKEND}/api/integrations/github-app/oauth/start`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ repo: "x", platform: "web" });
    expect(backend.headers.authorization).toBeUndefined();
    expect(backend.headers.cookie).toBeUndefined();
  });

  it("passes everything else to the Vercel Build app with forwarding headers", async () => {
    const response = await build("/api/bff/build/runs?id=1", { headers: { cookie: "aomi_github=t" } });
    const body = await response.json();
    expect(body.tag).toBe("vercel");
    expect(body.url).toBe(`${UPSTREAM}/api/bff/build/runs?id=1`);
    expect(body.headers.cookie).toBe("aomi_github=t");
    expect(body.headers["x-forwarded-host"]).toBe("build.example");
    expect(response.headers.get("set-cookie")).toBe("vercel=1");
  });
});
