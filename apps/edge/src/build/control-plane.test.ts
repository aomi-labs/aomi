// @vitest-environment node
import { SignJWT, jwtVerify, importSPKI, type KeyLike } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { handleRequest } from "../handler";
import { resetEdgeServices } from "../identity";
import type { FetchLike } from "../kernel/proxy";

const BUILD = "https://build.example";
const UPSTREAM = "https://build-vercel.example";
const MANAGER = "https://manager.example";
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
  BACKEND_ORIGINS: "https://backend.example",
  MANAGER_ORIGIN: MANAGER,
  API_SERVER_ORIGIN: "https://agent.example",
  APP_DEPLOY_PLATFORMS: "web",
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

const PROJECT = {
  id: 7,
  repository_link: "octo/app",
  platform_name: "web",
  installation_id: 99,
  apps: [{ id: 11, name: "api", is_active: true, app_release_tag: "api-v1" }],
};

type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
let seen: Seen[];
let edgePublicKey: KeyLike;

/** The manager, faked: owned projects, bots and the server tags. */
const world: FetchLike = async (request) => {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => (headers[name] = value));
  seen.push({ url: request.url, method: request.method, headers, body });
  if (url.origin === MANAGER) {
    if (!headers.authorization) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname === "/api/integrations/github-app/user/projects") {
      return Response.json({ projects: url.searchParams.get("github_user_id") === "4242" ? [PROJECT] : [] });
    }
    if (url.pathname === "/api/integrations/github-app/user/bots") {
      if (request.method === "POST") return Response.json({ bot_registration: { id: "bot-1", ...JSON.parse(body) } });
      return Response.json({ bots: [] });
    }
    if (url.pathname === "/api/platforms/server-tags")
      return Response.json({ server_tags: ["v1", "v2"], sdk_version: "1.2.3" });
    if (url.pathname === "/api/integrations/github-app/user/projects/7/attempts")
      return Response.json({ attempts: [{ run_id: 5, status: "queued" }], next_page: null });
    return Response.json({ error: `unexpected manager path ${url.pathname}` }, { status: 599 });
  }
  if (url.origin === UPSTREAM) return Response.json({ tag: "vercel", url: request.url });
  return new Response("unexpected origin", { status: 599 });
};

async function sessionCookie(sub = "4242"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ login: "octocat", installationId: "99" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(SECRET));
  return `aomi_github=${token}`;
}

async function cliBearer(scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ login: "octocat", installationId: null, kind: "cli_session", scopes })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("4242")
    .setAudience("aomi-build-cli")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(SECRET));
}

function build(path: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return handleRequest(new Request(`${BUILD}${path}`, { ...init, headers }), env, world);
}

async function managerBearer(entry: Seen) {
  const token = entry.headers.authorization?.replace(/^Bearer /, "") ?? "";
  return (await jwtVerify(token, edgePublicKey, { issuer: "aomi-edge" })).payload;
}

beforeAll(async () => {
  edgePublicKey = await importSPKI(DEV_PUBLIC_KEY, "EdDSA");
});

beforeEach(() => {
  seen = [];
  resetEdgeServices();
});

describe("build control plane: launch and deployments", () => {
  it("lists the signed-in user's projects through the manager as the aomi-edge service", async () => {
    expect((await build("/api/bff/launch/projects")).status).toBe(401);
    const response = await build("/api/bff/deployments/projects", { headers: { cookie: await sessionCookie() } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.githubLogin).toBe("octocat");
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({ id: 7, repositoryLink: "octo/app", platformName: "web" });
    const [call] = seen;
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe(`${MANAGER}/api/integrations/github-app/user/projects`);
    expect(url.searchParams.get("github_user_id")).toBe("4242");
    expect(call.headers.cookie).toBeUndefined();
    const bearer = await managerBearer(call);
    expect(bearer).toMatchObject({ role: "service", sub: "aomi-edge", aud: "aomi-backend" });
    expect(bearer.exp! - bearer.iat!).toBe(5 * 60);
  });

  it("answers the SDK status from the server tags with the CLI fix hint", async () => {
    const response = await build("/api/bff/launch/sdk-status");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      serverTags: ["v1", "v2"],
      sdkStatus: {
        requiredVersion: "1.2.3",
        status: "unknown",
        fixCommand: "aomi-build sdk fix --backend https://backend.example",
      },
    });
  });

  it("gates writes on the cookie origin and on project ownership", async () => {
    const cookie = await sessionCookie();
    const crossSite = await build("/api/bff/deployments/preflight", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7 }),
      origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);

    const notOwned = await build("/api/bff/launch/activate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectId: 999, releaseTags: ["api-v1"], apps: ["api"] }),
      origin: BUILD,
    });
    expect(notOwned.status).toBe(404);
    expect(await notOwned.json()).toEqual({ error: "project not found for this user" });
  });

  it("accepts a CLI bearer with the right scope on the attempts route", async () => {
    const readOnly = await cliBearer(["deployment:read"]);
    const response = await build("/api/bff/launch/attempts?projectId=7", {
      headers: { authorization: `Bearer ${readOnly}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [call] = seen;
    expect(new URL(call.url).pathname).toBe("/api/integrations/github-app/user/projects/7/attempts");

    // Starting an attempt needs the deploy scope; a read-only bearer falls back
    // to the (absent) cookie session.
    const write = await build("/api/bff/launch/attempts", {
      method: "POST",
      headers: { authorization: `Bearer ${readOnly}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: 7, action: "start" }),
      origin: BUILD,
    });
    expect(write.status).toBe(401);
  });

  it("answers 405 for a method the route does not take", async () => {
    const response = await build("/api/bff/launch/projects", { method: "DELETE" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("build control plane: operate", () => {
  it("scopes bots to the user's projects and refuses apps they do not own", async () => {
    const cookie = await sessionCookie();
    const list = await build("/api/bff/operate/bots?projectId=7", { headers: { cookie } });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.bots).toEqual([]);
    expect(body.projects.map((project: { id: number }) => project.id)).toEqual([7]);

    const foreign = await build("/api/bff/operate/bots", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ applicationIds: [12], handoverApplicationId: 12, credential: "tg-token" }),
      origin: BUILD,
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "selected apps are not owned by this user" });
  });

  it("rejects an unknown project and a malformed platform before reaching the manager", async () => {
    const cookie = await sessionCookie();
    seen = [];
    const badPlatform = await build("/api/bff/operate/usage?platform=Not%20Valid", { headers: { cookie } });
    expect(badPlatform.status).toBe(400);
    expect(seen).toEqual([]);
    const unknown = await build("/api/bff/operate/logs?projectId=999", { headers: { cookie } });
    expect(unknown.status).toBe(404);
  });

  it("still passes the build sandbox routes through to Vercel", async () => {
    const response = await build("/api/bff/build/supervise", { method: "POST", headers: { cookie: "aomi_github=x" } });
    expect((await response.json()).tag).toBe("vercel");
  });
});
