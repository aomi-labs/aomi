// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getMigrations } from "better-auth/db/migration";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "@aomi-labs/account/better-auth";

const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const databaseName = `aomi_auth_issuer_cutover_${randomUUID().replaceAll("-", "")}`;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
const origin = "https://aomi.chat";

// skip-reason: Requires an explicitly disposable loopback PostgreSQL database; CI supplies it.
describe.skipIf(!enabled)("Canonical Chat issuer migration", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let admin: import("pg").Pool;
  let databaseCreated = false;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname))
      throw new Error(
        "Issuer migration tests require a disposable loopback auth database",
      );
    const { Pool } = createRequire(
      createRequire(import.meta.url).resolve(
        "@aomi-labs/account/rate-limits.sql",
      ),
    )("pg") as typeof import("pg");
    admin = new Pool({ connectionString });
    await admin.query(`create database "${databaseName}"`);
    databaseCreated = true;
    url.pathname = `/${databaseName}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    vi.stubEnv("BETTER_AUTH_URL", origin);
    pool = (await import("@aomi-labs/account")).getPool();
    const fixture = new URL(
      "../../../../tests/fixtures/account-merge/",
      import.meta.url,
    );
    for (const file of [
      "../../e2e/fixtures/canonical-account-schema.sql",
      "schema.sql",
      "20261007000000_account_merge.sql",
    ])
      await pool.query(readFileSync(new URL(file, fixture), "utf8"));
    await pool.query(
      readFileSync(
        new URL(
          "../../../../packages/account/src/db/rate-limits.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await (
      await getMigrations(createAuth(process.env).options)
    ).runMigrations();
  }, 30_000);

  afterAll(async () => {
    try {
      await pool?.end();
      if (databaseCreated) await admin.query(`drop database "${databaseName}"`);
    } finally {
      await admin?.end();
      vi.unstubAllEnvs();
    }
  });

  it("keeps account identity and OAuth issuance isolated across canonical and legacy hosts", async () => {
    const { handleRequest } = await import("../handler");
    const alias = "https://chat.aomi.dev";
    const signer = privateKeyToAccount(generatePrivateKey());
    const env = {
      NODE_ENV: "development",
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "wallet-alias-test-secret-at-least-32-bytes",
      PORTAL_LEGACY_AUTH: JSON.stringify({
        origin: alias,
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
      }),
      PORTAL_HOSTS: `${new URL(origin).host},${new URL(alias).host}`,
      PORTAL_UPSTREAM_ORIGIN: "http://pages.invalid",
      AOMI_TRUSTED_ORIGINS: `${origin},${alias}`,
    };
    const call = (host: string, path: string, body?: object, cookie?: string) =>
      handleRequest(
        new Request(`${host}${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            origin: host,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
        fetch,
      );
    const canonicalUsers: unknown[] = [];
    const form = (host: string, path: string, body: Record<string, string>) =>
      handleRequest(
        new Request(`${host}/api/auth${path}`, {
          method: "POST",
          headers: {
            origin: host,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(body),
        }),
        env,
        fetch,
      );
    const userIds: string[] = [];
    // Revisit the canonical host to catch an auth-server cache shared across domains.
    for (const host of [origin, alias, origin]) {
      const nonceResponse = await call(host, "/api/auth/siwe/nonce", {});
      expect(nonceResponse.status).toBe(200);
      const { nonce } = await nonceResponse.json();
      const message = createSiweMessage({
        address: signer.address,
        chainId: 1,
        version: "1",
        nonce,
        domain: new URL(host).host,
        uri: host,
        issuedAt: new Date(),
      });
      const signedIn = await call(host, "/api/auth/siwe/verify", {
        message,
        signature: await signer.signMessage({ message }),
      });
      expect(signedIn.status, host).toBe(200);
      const { user } = await signedIn.json();
      userIds.push(user.id);
      const setCookie = signedIn.headers.get("set-cookie")!;
      expect(setCookie.toLowerCase().includes("domain=")).toBe(false);
      expect(setCookie.toLowerCase().includes("secure")).toBe(true);
      const cookie = setCookie.split(";", 1)[0];
      const session = await call(
        host,
        "/api/auth/get-session",
        undefined,
        cookie,
      );
      expect(session.status).toBe(200);
      expect((await session.json()).user.id).toBe(user.id);
      const resource = `${host}/v1/agent`;
      const grant = "urn:ietf:params:oauth:grant-type:device_code";
      const registration = await call(host, "/api/auth/oauth2/register", {
        client_name: "issuer migration fixture",
        token_endpoint_auth_method: "none",
        grant_types: [grant, "refresh_token"],
        resources: [resource],
        scope: "agent:read offline_access",
      });
      expect(registration.status).toBe(201);
      const { client_id } = await registration.json();
      const issued = await form(host, "/device/code", {
        client_id,
        resource,
        scope: "agent:read offline_access",
      });
      expect(issued.status).toBe(200);
      const code = await issued.json();
      const verified = await call(
        host,
        `/api/auth/device?${new URLSearchParams({ user_code: code.user_code })}`,
        undefined,
        cookie,
      );
      expect(verified.status, `device verification on ${host}`).toBe(200);
      const approved = await call(
        host,
        "/api/auth/device/approve",
        { userCode: code.user_code },
        cookie,
      );
      expect(approved.status, `device approval on ${host}`).toBe(200);
      const issuedToken = await form(host, "/oauth2/token", {
        grant_type: grant,
        client_id,
        resource,
        device_code: code.device_code,
      });
      expect(issuedToken.status).toBe(200);
      const tokens = await issuedToken.json();
      const jwksResponse = await call(host, "/api/auth/jwks");
      expect(jwksResponse.status).toBe(200);
      const jwks = createLocalJWKSet(await jwksResponse.json());
      const { payload } = await jwtVerify(tokens.access_token, jwks, {
        issuer: `${host}/api/auth`,
        audience: resource,
      });
      canonicalUsers.push(payload["https://aomi.dev/canonical_user_id"]);
      expect(typeof canonicalUsers.at(-1)).toBe("string");
      const refresh = {
        grant_type: "refresh_token",
        client_id,
        resource,
        refresh_token: tokens.refresh_token,
      };
      const refreshed = await form(host, "/oauth2/token", refresh);
      expect(refreshed.status).toBe(200);
      const next = await refreshed.json();
      expect(next.refresh_token === tokens.refresh_token).toBe(false);
      await jwtVerify(next.access_token, jwks, {
        issuer: `${host}/api/auth`,
        audience: resource,
      });
      const replay = await form(host, "/oauth2/token", refresh);
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe("invalid_grant");
    }
    expect(new Set(userIds).size).toBe(1);
    expect(new Set(canonicalUsers).size).toBe(1);
    for (const host of [origin, alias]) {
      const discovery = await call(
        host,
        "/.well-known/oauth-authorization-server",
      );
      expect(discovery.status).toBe(200);
      const metadata = await discovery.json();
      expect(metadata.issuer).toBe(`${host}/api/auth`);
      expect(new URL(metadata.token_endpoint).origin).toBe(host);
      const resource = await call(
        host,
        "/.well-known/oauth-protected-resource/v1/agent/mcp",
      );
      expect(resource.status).toBe(200);
      const protectedMetadata = await resource.json();
      expect(protectedMetadata.resource).toBe(`${host}/v1/agent/mcp`);
      expect(protectedMetadata.authorization_servers).toEqual([
        `${host}/api/auth`,
      ]);
    }

    const { nonce } = await (
      await call(alias, "/api/auth/siwe/nonce", {})
    ).json();
    const message = createSiweMessage({
      address: signer.address,
      chainId: 1,
      version: "1",
      nonce,
      domain: "unrelated.invalid",
      uri: alias,
      issuedAt: new Date(),
    });
    const wrongDomain = await call(alias, "/api/auth/siwe/verify", {
      message,
      signature: await signer.signMessage({ message }),
    });
    expect(wrongDomain.status).toBe(401);
  });
});
