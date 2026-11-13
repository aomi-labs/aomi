// @vitest-environment node
import { GitHubSessionSigner } from "@aomi-labs/account/build-session";
import { decodeJwt, importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { EdgeEnv } from "../env";
import { resetEdgeServices } from "../identity";
import { sha256Hex } from "../kernel/crypto";
import type { FetchLike } from "../kernel/proxy";
import type { ApiKey, ApiKeyStore } from "./api-keys";
import { buildContext } from "./context";
import { managerClient } from "./manager-client";
import { BUILD_ROUTES, handleBuildRequest } from "./routes";

const BUILD = "https://build.example";
const MANAGER = "https://manager.example";
const SECRET = "build-session-secret-for-tests";
const ALICE = "4242";
const BOB = "777";

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
  BUILD_UPSTREAM_ORIGIN: "https://build-vercel.example",
  BUILD_SESSION_SECRET: SECRET,
  BACKEND_ORIGINS: "https://backend.example",
  MANAGER_ORIGIN: MANAGER,
  PAYMENT_ORIGIN: "https://payment.example",
  BUILD_DEFAULT_PLATFORM: "web",
  EDGE_TOPOLOGY: "default",
  EDGE_SERVICE_PRIVATE_KEY: DEV_PRIVATE_KEY,
};

type Stored = ApiKey & { hash: string; builderId: string };

/** The `api_keys` table in memory, with the ownership rules of the SQL store. */
function memoryKeys() {
  const rows: Stored[] = [];
  let clock = 1_800_000_000;
  let touchFails = false;
  const visible = ({ hash: _hash, builderId: _builderId, ...key }: Stored): ApiKey => key;
  const store: ApiKeyStore = {
    async create({ hash, prefix, builderId, capabilities, label }) {
      const row: Stored = {
        id: rows.length + 1,
        prefix,
        label,
        capabilities,
        createdAt: clock++,
        lastUsedAt: null,
        revokedAt: null,
        hash,
        builderId,
      };
      rows.push(row);
      return visible(row);
    },
    async list(builderId) {
      return rows.filter((row) => row.builderId === builderId).map(visible);
    },
    async revoke(builderId, id) {
      const row = rows.find((candidate) => candidate.id === id && candidate.builderId === builderId);
      if (row) row.revokedAt ??= clock++;
      return Boolean(row);
    },
    async find(hash) {
      const row = rows.find((candidate) => candidate.hash === hash && candidate.revokedAt === null);
      return row ? { id: row.id, builderId: row.builderId, capabilities: row.capabilities } : null;
    },
    async touch(id) {
      if (touchFails) throw new Error("database is read-only");
      rows.find((row) => row.id === id)!.lastUsedAt = clock++;
    },
  };
  return { rows, store, failTouches: () => (touchFails = true) };
}

type Seen = { url: URL; method: string; authorization: string | null };
let seen: Seen[];
let keys: ReturnType<typeof memoryKeys>;

/** Every upstream answers; a test asserts on what was sent, and to where. */
const upstream: FetchLike = async (request) => {
  const url = new URL(request.url);
  seen.push({ url, method: request.method, authorization: request.headers.get("authorization") });
  if (url.pathname === "/api/integrations/github-app/user/projects") return Response.json({ projects: [] });
  if (url.pathname === "/api/platforms/server-tags") return Response.json({ server_tags: ["v1"], sdk_version: "1.2.3" });
  return Response.json({ ok: true });
};

const signer = new GitHubSessionSigner(SECRET);
const cookie = async (githubUserId: string) =>
  `aomi_github=${await signer.issueSession({ githubUserId, githubLogin: `user-${githubUserId}` })}`;

function build(path: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`${BUILD}${path}`, init);
  return handleBuildRequest(request, { ...buildContext(request, env, upstream)!, keys: keys.store });
}

/** A portal write: the session cookie from Build's own origin. */
async function portalWrite(githubUserId: string, method: string, body: unknown): Promise<Response> {
  return build("/api/build/keys", {
    method,
    headers: { cookie: await cookie(githubUserId), origin: BUILD, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createKey(githubUserId: string, capabilities: string[], label?: string) {
  const response = await portalWrite(githubUserId, "POST", { capabilities, label });
  expect(response.status).toBe(201);
  return (await response.json()) as ApiKey & { key: string };
}

async function listKeys(githubUserId: string): Promise<ApiKey[]> {
  const response = await build("/api/build/keys", { headers: { cookie: await cookie(githubUserId) } });
  expect(response.status).toBe(200);
  return (await response.json()).keys;
}

const withKey = (key: string, extra: Record<string, string> = {}) => ({
  headers: { authorization: `Bearer ${key}`, ...extra },
});

const roleOf = (call: Seen) => decodeJwt(call.authorization!.replace(/^Bearer /, "")).role;

beforeEach(() => {
  seen = [];
  keys = memoryKeys();
  resetEdgeServices();
});

describe("builder API key management", () => {
  it("returns the key once and stores only its hash", async () => {
    const created = await createKey(ALICE, ["project:deploy", "project:observe", "project:deploy"], " ci ");
    expect(created.key).toMatch(/^aomi_key_[A-Za-z0-9_-]{43}$/);
    expect(created).toMatchObject({
      id: 1,
      prefix: created.key.slice(0, 16),
      label: "ci",
      capabilities: ["project:deploy", "project:observe"],
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(keys.rows[0].hash).toBe(await sha256Hex(created.key));
    expect(JSON.stringify(keys.rows)).not.toContain(created.key);

    const [listed] = await listKeys(ALICE);
    expect(listed).toEqual({
      id: 1,
      prefix: created.prefix,
      label: "ci",
      capabilities: ["project:deploy", "project:observe"],
      createdAt: created.createdAt,
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("lists and revokes only the caller's own keys", async () => {
    const mine = await createKey(ALICE, ["project:deploy"]);
    expect(await listKeys(BOB)).toEqual([]);

    const foreign = await portalWrite(BOB, "DELETE", { id: mine.id });
    expect(foreign.status).toBe(404);
    expect((await listKeys(ALICE))[0].revokedAt).toBeNull();

    const own = await portalWrite(ALICE, "DELETE", { id: mine.id });
    expect(own.status).toBe(200);
    expect((await listKeys(ALICE))[0].revokedAt).toEqual(expect.any(Number));
  });

  it("validates capabilities against the three names", async () => {
    for (const capabilities of [["project:delete"], ["builder:read"], "project:deploy", undefined])
      expect((await portalWrite(ALICE, "POST", { capabilities })).status).toBe(400);
    expect(keys.rows).toEqual([]);
  });

  it("takes the portal session only", async () => {
    const body = JSON.stringify({ capabilities: ["project:deploy"] });
    const json = { "content-type": "application/json" };
    expect((await build("/api/build/keys")).status).toBe(401);
    // A cookie write from another origin.
    const crossOrigin = { ...json, cookie: await cookie(ALICE), origin: "https://evil.example" };
    expect((await build("/api/build/keys", { method: "POST", headers: crossOrigin, body })).status).toBe(403);
    // A CLI bearer is not a portal sign-in.
    const cli = await signer.issueCliSession({ githubUserId: ALICE, githubLogin: "alice" });
    const cliHeaders = { ...json, authorization: `Bearer ${cli}` };
    expect((await build("/api/build/keys", { headers: cliHeaders })).status).toBe(401);
    expect((await build("/api/build/keys", { method: "POST", headers: cliHeaders, body })).status).toBe(403);
    expect(keys.rows).toEqual([]);
  });
});

describe("builder API key callers", () => {
  it("refuses an unknown or revoked key, even beside a valid session", async () => {
    const { key, id } = await createKey(ALICE, ["project:deploy"]);
    const unknown = `aomi_key_${"x".repeat(43)}`;
    expect((await build("/api/build/deployments/projects", withKey(unknown))).status).toBe(401);
    expect(
      (await build("/api/build/deployments/projects", withKey(unknown, { cookie: await cookie(ALICE) }))).status,
    ).toBe(401);

    expect((await build("/api/build/deployments/projects", withKey(key))).status).toBe(200);
    await portalWrite(ALICE, "DELETE", { id });
    seen = [];
    expect((await build("/api/build/deployments/projects", withKey(key))).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("calls the manager as the key's builder, never as the edge service", async () => {
    const { key } = await createKey(ALICE, ["project:deploy", "project:observe"]);
    // A key for Alice beside Bob's cookie is still Alice.
    const response = await build(
      "/api/build/deployments/projects",
      withKey(key, { cookie: await cookie(BOB) }),
    );
    expect(response.status).toBe(200);

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call.url.origin + call.url.pathname).toBe(`${MANAGER}/api/integrations/github-app/user/projects`);
    expect(call.url.searchParams.get("github_user_id")).toBe(ALICE);
    const { payload } = await jwtVerify(
      call.authorization!.replace(/^Bearer /, ""),
      await importSPKI(DEV_PUBLIC_KEY, "EdDSA"),
      { issuer: "aomi-edge", audience: "aomi-backend" },
    );
    expect(payload).toMatchObject({
      sub: ALICE,
      role: "user",
      scope: "project:deploy project:observe",
      resource: `${BUILD}/api/build`,
      auth_source: "api_key",
      principal_class: "builder",
    });
    expect(payload.exp! - payload.iat!).toBe(5 * 60);
    expect(keys.rows[0].lastUsedAt).toEqual(expect.any(Number));
  });

  it("sends a key without capabilities as an unscoped builder bearer", async () => {
    const { key } = await createKey(ALICE, []);
    expect((await build("/api/build/deployments/projects", withKey(key))).status).toBe(200);
    const payload = decodeJwt(seen[0].authorization!.replace(/^Bearer /, ""));
    expect(payload).toMatchObject({ sub: ALICE, role: "user", auth_source: "api_key", principal_class: "builder" });
    expect(payload).not.toHaveProperty("scope");
    expect(payload).not.toHaveProperty("resource");
  });

  it("serves the request when the last-used timestamp cannot be written", async () => {
    const { key } = await createKey(ALICE, ["project:deploy"]);
    keys.failTouches();
    expect((await build("/api/build/deployments/projects", withKey(key))).status).toBe(200);
  });

  it("answers 403 without an upstream call on every route that is not a manager endpoint", async () => {
    const { key } = await createKey(ALICE, ["project:deploy", "project:activate", "project:observe"]);
    // The cookie would open each of these; the key closes them.
    const signedIn = withKey(key, { cookie: await cookie(ALICE), origin: BUILD, "content-type": "application/json" });
    const closed: [string, string][] = [
      ["GET", "/api/build/keys"],
      ["POST", "/api/build/keys"],
      ["DELETE", "/api/build/keys"],
      ["GET", "/v1/builder/credits"],
      ["POST", "/v1/builder/credits/funding-events"],
      ["GET", "/api/build/auth/github/status"],
      ["GET", "/api/build/auth/github/login"],
      ["POST", "/api/build/auth/github/signout"],
      ["GET", "/api/build/cli/status"],
      ["POST", "/api/build/cli/exchange"],
      ["GET", "/api/integrations/github-app/oauth/start"],
      // Public, but it calls the manager with the service bearer.
      ["GET", "/api/build/deployments/sdk-status"],
      // The pass-through to the Vercel Build app.
      ["GET", "/api/build/sandbox/anything"],
      ["POST", "/api/integrations/anything"],
    ];
    for (const [method, path] of closed) {
      const body = method === "GET" ? undefined : JSON.stringify({ id: 1, capabilities: [] });
      const response = await build(path, { ...signedIn, method, body });
      expect([path, response.status]).toEqual([path, 403]);
      expect(await response.json()).toEqual({ error: "api_key_not_allowed" });
    }
    expect(seen).toEqual([]);
    expect(keys.rows).toHaveLength(1);
    expect(keys.rows[0].revokedAt).toBeNull();
  });

  it("opens only endpoint() routes that stay on the manager to keys", () => {
    const closed = BUILD_ROUTES.filter((route) => !route.keys).map((route) => route.operation);
    expect(closed).toEqual([
      "github.login",
      "github.callback",
      "github.claim",
      "github.status",
      "github.signout",
      "cli.login",
      "cli.exchange",
      "cli.status",
      "github_app.install_start",
      "api_key.list",
      "api_key.create",
      "api_key.revoke",
      "deployment.sdk_status",
      // These read the secrets vault, which a key cannot reach.
      "deployment.activate",
      "deployment.promote",
      "deployment.required_secrets",
      "deployment.secrets_read",
      "deployment.secrets_write",
      "deployment.secrets_delete",
    ]);
  });

  it("never mints the service bearer for a request that presents a key", async () => {
    const { key } = await createKey(ALICE, ["project:deploy"]);
    const request = new Request(`${BUILD}/api/build/deployments/projects`, withKey(key));
    const ctx = { ...buildContext(request, env, upstream)!, keys: keys.store };
    await expect(managerClient(request, ctx)).rejects.toMatchObject({ status: 403, code: "api_key_not_allowed" });
    expect(seen).toEqual([]);
  });

  it("keeps the builder bearer on manager routes", async () => {
    const { key } = await createKey(ALICE, ["project:deploy"]);
    const request = new Request(`${BUILD}/api/build/deployments/secrets`, withKey(key));
    const ctx = { ...buildContext(request, env, upstream)!, keys: keys.store };
    const grant = (await keys.store.find(await sha256Hex(key)))!;
    const client = await managerClient(request, ctx, {
      session: { githubUserId: ALICE, githubLogin: "" },
      visibilityGrant: null,
      key: grant,
    });
    // The secrets vault is a backend service route, not a manager route.
    await expect(client.listAppSecrets({ applicationId: 42 })).rejects.toMatchObject({ status: 403 });
    expect(seen).toEqual([]);
    // A manager route outside the builder door still gets the builder bearer; the manager refuses it.
    await client.serverTags();
    expect(seen.map(roleOf)).toEqual(["user"]);
  });

  it("leaves session and CLI callers on the service bearer", async () => {
    const viaCookie = await build("/api/build/deployments/projects", { headers: { cookie: await cookie(ALICE) } });
    expect(viaCookie.status).toBe(200);
    const cli = await signer.issueCliSession({ githubUserId: ALICE, githubLogin: "alice" });
    const viaCli = await build("/api/build/deployments/attempts?projectId=7", {
      headers: { authorization: `Bearer ${cli}` },
    });
    expect(viaCli.status).toBe(200);
    expect(seen.map(roleOf)).toEqual(["service", "service"]);
    for (const call of seen) expect(call.url.searchParams.get("github_user_id")).toBe(ALICE);
  });
});
