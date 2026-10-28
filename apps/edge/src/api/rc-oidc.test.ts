// @vitest-environment node
import { exportPKCS8, generateKeyPair, SignJWT, decodeJwt, type CryptoKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EdgeCache, EdgeEnv } from "../env";
import { handleRequest } from "../handler";
import { resetEdgeServices } from "../identity";
import { EdgeError } from "../kernel/errors";
import { resolveRoute } from "./routes";
import { exchangeRcToken, RC_OIDC_AUDIENCE, RC_OIDC_ISSUER, rcOidcConfig } from "./rc-oidc";

const SUBJECT = "repo:aomi-labs/product-mono:environment:rc";
const WORKFLOW = "aomi-labs/product-mono/.github/workflows/rc-acceptance.yml@refs/heads/main";
const ACCOUNT = "1ae6dbf7-13d8-41f4-8fde-b8a6f4809d98";
const NOW = 1_800_000_000_000;

let oidcPrivate: CryptoKey;
let oidcPublic: CryptoKey;
let env: EdgeEnv;
let store: Map<string, string>;

const cache = (map: Map<string, string>): EdgeCache => ({
  get: async (key) => map.get(key) ?? null,
  put: async (key, value) => void map.set(key, value),
  delete: async (key) => void map.delete(key),
});

beforeAll(async () => {
  ({ privateKey: oidcPrivate, publicKey: oidcPublic } = await generateKeyPair("RS256", { extractable: true }));
});

beforeEach(async () => {
  resetEdgeServices();
  const edge = await generateKeyPair("EdDSA", { extractable: true });
  store = new Map();
  env = {
    EDGE_TOPOLOGY: "rc",
    EDGE_SERVICE_PRIVATE_KEY: await exportPKCS8(edge.privateKey),
    API_SERVER_ORIGIN: "https://agent-rc.aomi.dev",
    BACKEND_ORIGINS: "https://backend-rc-4.aomi.dev",
    CORS_ALLOWED_HOST_PATTERNS: "api-rc.aomi.dev",
    RC_OIDC_ACCOUNT_ID: ACCOUNT,
    RC_OIDC_SUBJECT: SUBJECT,
    RC_OIDC_WORKFLOWS: WORKFLOW,
    EDGE_CACHE: cache(store),
  };
});

type Claims = Record<string, unknown>;
async function oidc(overrides: Claims = {}, options: { aud?: string; iss?: string; iat?: number } = {}) {
  const iat = options.iat ?? Math.floor(NOW / 1000);
  return new SignJWT({
    repository: "aomi-labs/product-mono",
    ref: "refs/heads/main",
    environment: "rc",
    job_workflow_ref: WORKFLOW,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(SUBJECT)
    .setIssuer(options.iss ?? RC_OIDC_ISSUER)
    .setAudience(options.aud ?? RC_OIDC_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + 600)
    .sign(oidcPrivate);
}

/** A refusal is an EdgeError at the surface; here it reads as its status. */
const settle = async (call: () => Promise<Response>) =>
  call().catch((error: unknown) => {
    if (error instanceof EdgeError) return new Response(null, { status: error.status });
    throw error;
  });

const exchange = (token: string, method = "POST") =>
  settle(() =>
    exchangeRcToken(
      new Request("https://api-rc.aomi.dev/v1/rc/token", { method, headers: { authorization: `Bearer ${token}` } }),
      env,
      rcOidcConfig(env, "api-rc.aomi.dev")!,
      async () => oidcPublic,
      NOW,
    ),
  );

describe("rc oidc exchange", () => {
  it("mints a short user bearer for the configured account only", async () => {
    const response = await exchange(await oidc());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; expires_in: number; scope: string };
    const claims = decodeJwt(body.access_token);
    expect(claims.sub).toBe(ACCOUNT);
    expect(claims.iss).toBe("aomi-edge");
    expect(claims.aud).toBe("aomi-api-server");
    expect(claims.role).toBe("user");
    expect(claims.resource).toBe("https://api-rc.aomi.dev/v1/agent");
    expect(claims.scope).toBe("agent:read agent:write");
    expect(claims.principal_class).toBe("user");
    expect(body.expires_in).toBe(900);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a replayed token", async () => {
    const token = await oidc();
    expect((await exchange(token)).status).toBe(200);
    const again = await exchange(token);
    expect(again.status).toBe(401);
  });

  it.each([
    ["wrong audience", () => oidc({}, { aud: "other" }), 401],
    ["wrong issuer", () => oidc({}, { iss: "https://evil.example" }), 401],
    ["expired", () => oidc({}, { iat: Math.floor(NOW / 1000) - 3600 }), 401],
    ["wrong ref", () => oidc({ ref: "refs/heads/feature" }), 403],
    ["wrong environment", () => oidc({ environment: "staging" }), 403],
    ["wrong repository", () => oidc({ repository: "aomi-labs/other" }), 403],
    ["unlisted workflow", () => oidc({ job_workflow_ref: "aomi-labs/product-mono/.github/workflows/x.yml@refs/heads/main" }), 403],
  ] as const)("rejects %s", async (_name, make, status) => {
    expect((await exchange(await make())).status).toBe(status);
  });

  it("rejects a token signed by another key and a non-bearer credential", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(RC_OIDC_ISSUER)
      .setAudience(RC_OIDC_AUDIENCE).setSubject(SUBJECT).sign(other.privateKey);
    expect((await exchange(forged)).status).toBe(401);
    const response = await settle(() =>
      exchangeRcToken(
        new Request("https://api-rc.aomi.dev/v1/rc/token", { method: "POST", headers: { authorization: "Basic abc" } }),
        env, rcOidcConfig(env, "api-rc.aomi.dev")!, async () => oidcPublic, NOW,
      ),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed without a replay store", async () => {
    delete env.EDGE_CACHE;
    const response = await exchange(await oidc());
    expect(response.status).toBe(503);
  });
});

describe("rc identity gating", () => {
  it("is off outside the rc topology or when incompletely configured", () => {
    expect(rcOidcConfig({ ...env, EDGE_TOPOLOGY: "production" }, "api.aomi.dev")).toBeNull();
    expect(rcOidcConfig({ ...env, EDGE_TOPOLOGY: "staging" }, "api-staging.aomi.dev")).toBeNull();
    expect(rcOidcConfig({ ...env, RC_OIDC_ACCOUNT_ID: "" }, "api-rc.aomi.dev")).toBeNull();
    expect(rcOidcConfig({ ...env, RC_OIDC_WORKFLOWS: undefined }, "api-rc.aomi.dev")).toBeNull();
  });

  it("routes agent REST only on rc and never MCP", () => {
    const route = (e: EdgeEnv, host: string, path: string) => resolveRoute(new URL(`https://${host}${path}`), e);
    expect(route(env, "api-rc.aomi.dev", "/v1/agent/chat")?.name).toBe("agent");
    expect(route(env, "api-rc.aomi.dev", "/v1/agent/chat/abc/stream")?.name).toBe("agent");
    expect(route(env, "api-rc.aomi.dev", "/v1/agent/mcp")).toBeNull();
    const production = { ...env, EDGE_TOPOLOGY: "production" as const };
    expect(route(production, "api.aomi.dev", "/v1/agent/chat")).toBeNull();
  });

  it("answers the token route with 404 off rc and forwards agent calls with the caller's bearer only", async () => {
    const production = { ...env, EDGE_TOPOLOGY: "production" as const };
    const off = await handleRequest(
      new Request("https://api.aomi.dev/v1/rc/token", { method: "POST" }), production, async () => new Response("x"),
    );
    expect(off.status).toBe(404);

    let seen: Request | undefined;
    const response = await handleRequest(
      new Request("https://api-rc.aomi.dev/v1/agent/chat", {
        method: "POST",
        headers: { authorization: "Bearer abc", cookie: "session=1", "content-type": "application/json", origin: "https://api-rc.aomi.dev" },
        body: "{}",
      }),
      env,
      async (request) => ((seen = request), new Response("ok")),
    );
    expect(response.status).toBe(200);
    expect(seen?.url).toBe("https://agent-rc.aomi.dev/v1/agent/chat");
    expect(seen?.headers.get("authorization")).toBe("Bearer abc");
    expect(seen?.headers.has("cookie")).toBe(false);
  });
});
