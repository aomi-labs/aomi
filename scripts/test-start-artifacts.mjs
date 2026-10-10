#!/usr/bin/env node
// Controlled production-artifact integration: no real provider or deploy tokens.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { smokeStartArtifact } from "./smoke-start-artifact.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Providerless environment; callers cannot accidentally enable charged runs. */
export function artifactFixtureEnvironment(source = process.env) {
  return {
    PATH: source.PATH,
    AOMI_ARTIFACT_SECRET_CANARY: source.AOMI_ARTIFACT_SECRET_CANARY,
    NODE_ENV: "production",
    SENTRY_ENABLED: "0",
    AOMI_BUILD_RUNNER: "local",
    AOMI_ALLOW_STALE_SDK: "0",
  };
}

async function migrateDatabase(env) {
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsx",
      "apps/portal/scripts/migrate-browser-contract-db.ts",
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  const code = await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("exit", done);
  });
  assert.equal(code, 0, "Disposable artifact auth schema migration failed");
}

async function portalArtifact(artifact, fixtureEnv) {
  if (
    process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1" ||
    !process.env.AOMI_TEST_DATABASE_URL
  )
    throw new Error(
      "Portal artifacts require the browser suite's confirmed disposable Postgres database",
    );
  const databaseUrl = process.env.AOMI_TEST_DATABASE_URL;
  const { bffPrivateKey, startAgentUpstream } =
    await import("../tests/e2e/fake-backend/upstream.ts");
  const { portalEnv } = await import("../tests/e2e/portal-env.ts");
  const upstream = await startAgentUpstream({
    artifactStreamingDelayMs: 1_500,
  });
  const widgetOrigin = "https://artifact-fixture.invalid";
  const env = {
    ...fixtureEnv,
    ...portalEnv({
      portal: "http://127.0.0.1:3000",
      upstream: upstream.origin,
      databaseUrl,
      embedOrigins: [widgetOrigin],
    }),
    AOMI_TEST_DATABASE_DISPOSABLE: "1",
    PORTAL_SERVICE_PRIVATE_KEY: bffPrivateKey,
  };
  let pool;
  let userId;
  let ticketIdentifier;
  try {
    await migrateDatabase(env);
    const portalRequire = createRequire(join(root, "apps/portal/package.json"));
    const widgetEntry = pathToFileURL(
      portalRequire.resolve("@aomi-labs/account/widget-auth"),
    );
    const accountRequire = createRequire(
      portalRequire.resolve("@aomi-labs/account"),
    );
    const { Pool } = accountRequire("pg");
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const { issueWidgetSession, widgetSessionIdentifierForRequest } =
      await import(widgetEntry.href);
    const { widgetAuthStore, writeWidgetAuthTicket } = await import(
      new URL("./store.ts", widgetEntry).href
    );
    userId = randomUUID();
    await pool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    const session = await issueWidgetSession({
      userId,
      origin: widgetOrigin,
      authMethod: "siwe",
      store: {
        ...widgetAuthStore,
        write: (input) => writeWidgetAuthTicket({ ...input, db: pool }),
      },
    });
    const authorization = `Bearer ${session.token}`;
    ticketIdentifier = widgetSessionIdentifierForRequest(
      new Request(widgetOrigin, { headers: { authorization } }),
    );
    await smokeStartArtifact({
      app: "portal",
      artifact,
      env: { ...env, ARTIFACT_WIDGET_AUTHORIZATION: authorization },
      configureRuntime: (origin) => ({
        BETTER_AUTH_URL: origin,
        AOMI_PORTAL_BASE_URL: origin,
        AOMI_AUTH_DOMAIN: new URL(origin).host,
        AOMI_TRUSTED_ORIGINS: [origin, widgetOrigin].join(","),
      }),
      async probe({ check }) {
        await check({ path: "/?migration=a%2Bb", status: 200 });
        await check({
          path: "/settings/?migration=a%2Bb",
          status: 308,
          headers: {
            location: "/settings?migration=a%2Bb",
            refresh: "0;url=/settings?migration=a%2Bb",
          },
        });
        await check({
          path: "/openapi.json/?migration=a%2Bb",
          status: 308,
          headers: { location: "/openapi.json?migration=a%2Bb" },
        });
        await check({
          path: "/v1/account/credits/top-up/?migration=a%2Bb",
          method: "POST",
          body: { controlled: true },
          status: 308,
          headers: { location: "/v1/account/credits/top-up?migration=a%2Bb" },
        });
        await check({
          path: "/v1/account/credits/top-up",
          status: 405,
        });
        await check({
          path: "/openapi.json",
          method: "OPTIONS",
          status: 204,
          headers: { allow: "GET, HEAD, OPTIONS" },
        });
        await check({ path: "/openapi.json", method: "HEAD", status: 200 });
        const credential = {
          headersFromEnv: { authorization: "ARTIFACT_WIDGET_AUTHORIZATION" },
          requestHeaders: { origin: widgetOrigin },
        };
        await check({
          ...credential,
          path: "/v1/account",
          status: 200,
          json: { "user.id": userId },
        });
        await check({
          ...credential,
          path: "/api/account/model-keys",
          status: 200,
          json: { keys: [] },
        });
        await check({
          ...credential,
          path: "/v1/agent/artifact-stream",
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-transform",
          },
          stream: { minChunks: 2, maxFirstChunkMs: 800, minDurationMs: 1_200 },
        });
        const recordsResponse = await fetch(`${upstream.origin}/__records`);
        const { records } = await recordsResponse.json();
        for (const path of [
          "/api/account/model-keys",
          "/v1/agent/artifact-stream",
        ]) {
          const record = records.find((item) => item.path === path);
          assert.ok(
            record?.authorization === "verified-bff-bearer",
            `${path}: BFF assertion was not verified`,
          );
          assert.equal(
            record.principal.sub,
            userId,
            `${path}: canonical account changed`,
          );
          assert.equal(
            record.cookie,
            "absent",
            `${path}: browser cookie reached the upstream`,
          );
        }
        console.log(
          "PASS copied Portal forwards freshly signed assertions for the disposable canonical account",
        );
      },
    });
  } finally {
    try {
      if (pool) {
        try {
          if (ticketIdentifier)
            await pool.query(
              "DELETE FROM ba_verifications WHERE identifier = $1",
              [ticketIdentifier],
            );
          if (userId)
            await pool.query("DELETE FROM users WHERE id = $1", [userId]);
        } finally {
          await pool.end();
        }
      }
    } finally {
      await upstream.close();
    }
  }
}

async function buildArtifact(artifact, fixtureEnv) {
  const buildRequire = createRequire(join(root, "apps/build/package.json"));
  const { SignJWT } = await import(
    pathToFileURL(buildRequire.resolve("jose")).href
  );
  const secret = randomBytes(32).toString("hex");
  const login = "artifact-fixture";
  const token = await new SignJWT({ login })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("900000000000000001")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
  await smokeStartArtifact({
    app: "build",
    artifact,
    env: {
      ...fixtureEnv,
      PORTAL_ONLY_SESSION_SECRET: secret,
      ARTIFACT_GITHUB_COOKIE: `aomi_github=${token}`,
    },
    async probe({ origin, directory, check }) {
      await check({ path: "/?migration=a%2Bb", status: 200 });
      await check({
        path: "/projects/?migration=a%2Bb",
        status: 308,
        headers: {
          location: "/projects?migration=a%2Bb",
          refresh: "0;url=/projects?migration=a%2Bb",
        },
      });
      await check({
        path: "/api/bff/auth/github/status/?migration=a%2Bb",
        status: 308,
        headers: { location: "/api/bff/auth/github/status?migration=a%2Bb" },
      });
      await check({
        path: "/api/bff/cli/exchange/?migration=a%2Bb",
        method: "POST",
        body: { controlled: true },
        status: 308,
        headers: { location: "/api/bff/cli/exchange?migration=a%2Bb" },
      });
      await check({ path: "/api/bff/cli/exchange", status: 405 });
      await check({
        path: "/api/bff/auth/github/status",
        method: "OPTIONS",
        status: 204,
        headers: { allow: "GET, HEAD, OPTIONS" },
      });
      await check({
        path: "/api/bff/auth/github/status",
        method: "HEAD",
        status: 200,
      });
      const headersFromEnv = { cookie: "ARTIFACT_GITHUB_COOKIE" };
      await check({
        path: "/api/bff/auth/github/status",
        status: 200,
        headersFromEnv,
        json: { signedIn: true, githubLogin: login },
      });
      // The empty non-Git SDK deliberately stops binaries resolution before
      // cargo, agents or deployment. The real orchestrator must still execute
      // and persist that failure through its traced dependencies and Bun hooks.
      const sdkRoot = join(directory, "sdk-fixture");
      mkdirSync(sdkRoot);
      const app = `artifact_${randomBytes(8).toString("hex")}`;
      const start = await fetch(`${origin}/api/bff/build/runs`, {
        method: "POST",
        headers: {
          cookie: `aomi_github=${token}`,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Controlled artifact loader verification",
          app,
          builder: "none",
          autoApprove: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(
        start.status,
        200,
        "Copied Build could not initialize the real local Smither workflow",
      );
      const { runId } = await start.json();
      assert.ok(
        typeof runId === "string" && runId.startsWith(`smither-${app}-`),
        "Build did not allocate a durable run",
      );
      let snapshot;
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await fetch(
          `${origin}/api/bff/build/runs?id=${encodeURIComponent(runId)}`,
          {
            headers: { cookie: `aomi_github=${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        assert.equal(result.status, 200, "Durable Build run could not be read");
        snapshot = await result.json();
        if (snapshot.status === "failed") break;
        await delay(250);
      }
      assert.equal(
        snapshot?.status,
        "failed",
        "Controlled Smither workflow did not durably settle",
      );
      assert.match(
        JSON.stringify({ error: snapshot.error, lines: snapshot.lines }),
        /SDK checkout is not a git repository|GitHub-fresh SDK/,
      );
      assert.ok(
        snapshot.stages?.some(
          (stage) =>
            stage.id.endsWith(":binaries") && stage.status === "failed",
        ),
        "The orchestrator did not execute its deterministic first stage",
      );
      console.log(
        "PASS copied Build executes and persists the controlled Smither prerequisite failure on Node",
      );
    },
    configureRuntime: (origin) => ({
      AOMI_BUILD_URL: origin,
      // Relative paths resolve inside the copied artifact's temporary cwd.
      AOMI_SDK_ROOT: "sdk-fixture",
      SMITHER_RUNS_ROOT: ".smithers/runs",
      GIT_CEILING_DIRECTORIES: tmpdir(),
    }),
  });
}

export async function testStartArtifacts(args = process.argv.slice(2)) {
  register();
  const option = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const apps = option("--app") ? [option("--app")] : ["portal", "build"];
  if (apps.some((app) => !["portal", "build"].includes(app)))
    throw new Error("--app must be portal or build");
  const outputs = {
    portal: resolve(option("--portal-output", "apps/portal/.output")),
    build: resolve(option("--build-output", "apps/build/.output")),
  };
  for (const app of apps)
    if (!existsSync(join(outputs[app], "server/index.mjs")))
      throw new Error(
        `Build the ${app} Nitro Node artifact before running this check`,
      );
  const env = artifactFixtureEnvironment();
  if (
    !env.AOMI_ARTIFACT_SECRET_CANARY ||
    env.AOMI_ARTIFACT_SECRET_CANARY.length < 16
  )
    throw new Error(
      "Set the same AOMI_ARTIFACT_SECRET_CANARY used for the production build",
    );
  for (const app of apps)
    await (app === "portal"
      ? portalArtifact(outputs[app], env)
      : buildArtifact(outputs[app], env));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await testStartArtifacts();
