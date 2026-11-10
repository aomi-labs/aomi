// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getMigrations } from "better-auth/db/migration";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "@aomi-labs/account/better-auth";

const connectionString = process.env.AOMI_AUTH_TEST_DATABASE_URL;
const databaseName = `aomi_auth_loopback_test_alias_${randomUUID().replaceAll("-", "")}`;
const enabled = Boolean(
  connectionString && process.env.AOMI_TEST_DATABASE_DISPOSABLE === "1",
);
const origin = "http://localhost:3999";

// skip-reason: Requires an explicitly disposable loopback PostgreSQL database; CI supplies it.
describe.skipIf(!enabled)("Portal wallet domain aliases", () => {
  let pool: ReturnType<typeof import("@aomi-labs/account").getPool>;
  let admin: import("pg").Pool;
  let databaseCreated = false;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) ||
      !url.pathname.startsWith("/aomi_auth_loopback_test")
    )
      throw new Error(
        "Wallet alias tests require a disposable loopback auth database",
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

  it("binds wallet proofs to each Portal host while retaining the canonical OAuth issuer", async () => {
    const { handleRequest } = await import("../handler");
    const alias = "http://localhost:4000";
    const signer = privateKeyToAccount(generatePrivateKey());
    const env = {
      NODE_ENV: "test",
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "wallet-alias-test-secret-at-least-32-bytes",
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
      const cookie = signedIn.headers.get("set-cookie")!.split(";", 1)[0];
      const session = await call(
        host,
        "/api/auth/get-session",
        undefined,
        cookie,
      );
      expect(session.status).toBe(200);
      expect((await session.json()).user.id).toBe(user.id);
    }
    expect(new Set(userIds).size).toBe(1);
    const discovery = await call(
      alias,
      "/.well-known/oauth-authorization-server",
    );
    expect((await discovery.json()).issuer).toBe(`${origin}/api/auth`);

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
