#!/usr/bin/env node
// Controlled production-artifact integration: no real provider or deploy tokens.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import {
  artifactApps,
  smokeStartArtifact,
  verifyVercelArtifact,
} from "./smoke-start-artifact.mjs";
import {
  landingRollout,
  remainingMigrationBase,
} from "./check-start-route-parity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baselineBytes = (path, base = remainingMigrationBase) =>
  execFileSync("git", ["show", `${base}:${path}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });

/** Git stores an LFS pointer; the served artifact must contain the original object. */
export function baselineAssetHash(bytes) {
  const text = bytes.toString("utf8");
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1\n"))
    return sha256(bytes);
  const pointer = text.match(
    /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize ([1-9]\d*)\n?$/,
  );
  assert.ok(pointer, "Malformed immutable Git LFS asset pointer");
  return pointer[1];
}

/** Resolve local runtime assets, including relative URLs in the preserved homepage. */
export function landingAssetPaths(html, sourcePath = "/") {
  const origin = "https://artifact-fixture.invalid";
  // Inline style attributes encode CSS quotes; resolve the actual browser URL.
  const decoded = html.replace(
    /&(?:quot|apos|amp|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const named = { "&quot;": '"', "&apos;": "'", "&amp;": "&" };
      if (entity[1] !== "#") return named[entity.toLowerCase()];
      const code =
        entity[2].toLowerCase() === "x"
          ? parseInt(entity.slice(3, -1), 16)
          : Number(entity.slice(2, -1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\ufffd";
    },
  );
  const base = new URL(
    decoded.match(/<base\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? sourcePath,
    origin,
  );
  const assetContent = decoded.replace(/<base\b[^>]*>/gi, "");
  const cssUrl =
    /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^\s"'\\)])+))\s*\)/gi;
  const references = [
    ...[
      ...assetContent.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/gi),
    ].map((match) => match[1]),
    ...[...assetContent.matchAll(cssUrl)].map((match) =>
      (match[1] ?? match[2] ?? match[3])
        .replace(/\\(?:\r\n|[\r\n\f])/g, "")
        .replace(
          /\\(?:([0-9a-f]{1,6})\s?|([^\r\n\f]))/gi,
          (_, hex, character) => {
            if (!hex) return character;
            const code = parseInt(hex, 16);
            return code > 0 &&
              code <= 0x10ffff &&
              !(code >= 0xd800 && code <= 0xdfff)
              ? String.fromCodePoint(code)
              : "\ufffd";
          },
        ),
    ),
  ];
  return [
    ...new Set(
      references.flatMap((reference) => {
        // SVG filters target the current document; they are not runtime files.
        if (!reference || reference.startsWith("#")) return [];
        const url = new URL(reference, base);
        return url.origin === origin &&
          /^\/(?:assets|videos)\//.test(url.pathname)
          ? [url.pathname]
          : [];
      }),
    ),
  ].sort();
}

function landingStaticAssets() {
  const html = baselineBytes(
    "apps/landing/public/assets/landing/home/index.html",
  ).toString("utf8");
  const paths = new Set(landingAssetPaths(html));
  paths.add("/og-bg.jpg");
  for (const path of paths)
    if (path.endsWith(".css"))
      for (const child of landingAssetPaths(
        baselineBytes(`apps/landing/public${path}`).toString("utf8"),
        path,
      ))
        paths.add(child);
  const original = [...paths].map((path) => ({
    path,
    sha256: baselineAssetHash(baselineBytes(`apps/landing/public${path}`)),
  }));
  const rollout = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      landingRollout.base,
      "--",
      "apps/landing/public/assets/covers/",
      "apps/landing/public/research/introducing-the-aomi-task-api/",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((path) => ({
      path: path.slice("apps/landing/public".length),
      sha256: baselineAssetHash(baselineBytes(path, landingRollout.base)),
    }));
  return [...original, ...rollout];
}

function nativeStaticAssets(app) {
  if (app === "landing") return landingStaticAssets();
  const prefix = `apps/${app}/public/`;
  const paths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", remainingMigrationBase, "--", prefix],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const assets = paths.map((path) => ({
    path: `/${path.slice(prefix.length)}`,
    sha256: baselineAssetHash(baselineBytes(path)),
  }));
  if (app === "telegram")
    assets.push({
      path: "/assets/fonts/geist-latin.woff2",
      // Telegram uses the immutable Next Geist bytes already preserved by Portal.
      sha256: sha256(
        baselineBytes(
          "apps/portal/public/assets/fonts/google/geist-latin.woff2",
        ),
      ),
    });
  return assets;
}

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

async function landingArtifact(artifact, fixtureEnv, publicUpstreams = false) {
  const records = [];
  const upstream = createServer((request, response) => {
    records.push({
      path: request.url,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
    if (request.url === "/api/thread/state") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          thread_id: "copied-landing-thread",
          is_processing: false,
        }),
      );
    } else if (request.url === "/api/thread/updates") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      });
      response.write('data: {"sequence":1}\n\n');
      setTimeout(() => response.end('data: {"sequence":2}\n\n'), 1_500);
    } else response.writeHead(404).end();
  });
  await new Promise((done, fail) => {
    upstream.once("error", fail);
    upstream.listen(0, "127.0.0.1", done);
  });
  const backend = `http://127.0.0.1:${upstream.address().port}`;
  try {
    await smokeStartArtifact({
      app: "landing",
      artifact,
      env: {
        ...fixtureEnv,
        BACKEND_URL: backend,
        AOMI_PROXY_BACKEND_URL: backend,
      },
      async probe({ check }) {
        const html = baselineBytes(
          "apps/landing/public/assets/landing/home/index.html",
        );
        await check({
          path: "/",
          status: 200,
          bytesSha256: sha256(html),
          headers: {
            "content-type": "text/html",
            "cache-control": "must-revalidate",
          },
        });
        for (const asset of landingStaticAssets())
          await check({
            path: asset.path,
            status: 200,
            bytesSha256: asset.sha256,
          });
        await check({
          path: "/",
          method: "HEAD",
          status: 200,
          bodyAbsent: true,
        });
        await check({
          path: "/",
          method: "OPTIONS",
          status: 204,
          headers: { allow: "GET, HEAD, OPTIONS" },
        });
        await check({ path: "/agents.md", method: "POST", status: 405 });
        await check({
          path: "/agents.md/?migration=a%2Bb",
          status: 308,
          headers: { location: "/agents.md?migration=a%2Bb" },
        });
        await check({
          path: "/agents/?migration=a%2Bb",
          status: 308,
          headers: {
            location: "/agents?migration=a%2Bb",
            refresh: "0;url=/agents?migration=a%2Bb",
          },
        });
        const cache = { "cache-control": "s-maxage=3600" };
        for (const [path, file, type] of [
          ["/agents.md", "agents.md", "text/markdown"],
          ["/faq.md", "faq.md", "text/markdown"],
          ["/llms.txt", "llms.txt", "text/plain"],
        ])
          await check({
            path,
            status: 200,
            bytesSha256: sha256(
              baselineBytes(`apps/landing/content/agents/${file}`),
            ),
            headers: { ...cache, "content-type": type },
          });
        for (const [path, text, type] of [
          ["/agents/build.md", "# Build an Aomi app", "text/markdown"],
          ["/agents/transact.md", "# Transact with Aomi", "text/markdown"],
          ["/llms-full.txt", "# Aomi — full agent corpus", "text/plain"],
        ])
          await check({
            path,
            status: 200,
            headers: { ...cache, "content-type": type },
            textIncludes: [text],
          });
        await check({
          path: "/r/card.json",
          status: 200,
          bytesSha256: sha256(baselineBytes("apps/landing/public/r/card.json")),
          headers: {
            "content-type": "application/json",
            "cache-control": "s-maxage=300",
          },
        });
        await check({
          path: "/r/missing-controlled-artifact.json",
          status: 404,
          json: { error: "Not found" },
        });
        await check({
          path: "/r/%252e%252e/package.json",
          status: 404,
          json: { error: "Not found" },
        });
        await check({
          path: "/robots.txt",
          status: 200,
          headers: { "content-type": "text/plain" },
          textIncludes: [
            "User-Agent: GPTBot",
            "Disallow: /api/",
            "Sitemap: https://aomi.dev/sitemap.xml",
            "Sitemap: https://aomi.dev/docs/sitemap.xml",
          ],
        });
        await check({
          path: "/sitemap.xml",
          status: 200,
          headers: { "content-type": "application/xml" },
          textIncludes: [
            "<urlset",
            "https://aomi.dev/agents.md",
            "https://aomi.dev/research/three-gates-onchain",
            "https://aomi.dev/blog",
          ],
        });
        await check({
          path: "/agents",
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: ["Aomi", "agent"],
        });
        await check({ path: "/products/missing", status: 404 });
        await check({ path: "/solutions/missing", status: 404 });
        await check({
          path: "/research/three-gates-onchain",
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: ["Three Gates from Intent to Settlement", "runtime"],
        });
        await check({
          path: "/research/auth-across-two-worlds",
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: ["One User, Many Wallets", "Authentication"],
        });
        const taskApiTitle =
          "Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc";
        const taskApiPath = "/research/introducing-the-aomi-task-api";
        await check({
          path: "/blog",
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: [
            taskApiTitle,
            "One User, Many Wallets",
            "Three Gates from Intent to Settlement",
            'href="/research/introducing-the-aomi-task-api"',
          ],
          head: {
            title: "Blog | Aomi",
            names: {
              description: "Launches, announcements and notes from Aomi Labs.",
              robots: "noindex, nofollow",
            },
          },
        });
        await check({
          path: "/blog",
          method: "HEAD",
          status: 200,
          bodyAbsent: true,
        });
        await check({
          path: "/blog/?migration=a%2Bb",
          status: 308,
          headers: {
            location: "/blog?migration=a%2Bb",
            refresh: "0;url=/blog?migration=a%2Bb",
          },
        });
        for (const method of ["GET", "HEAD"])
          await check({
            path: "/news?migration=a%2Bb",
            method,
            status: 308,
            headers: { location: "/blog" },
            ...(method === "HEAD" ? { bodyAbsent: true } : {}),
          });
        await check({
          path: "/news/?migration=a%2Bb",
          status: 308,
          headers: { location: "/news?migration=a%2Bb" },
        });
        await check({
          path: "/research",
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: [
            "Three Gates from Intent to Settlement",
            "The State of Execution Harnesses",
            "AomiBench",
          ],
          textExcludes: [taskApiTitle, "One User, Many Wallets"],
          head: {
            title: "Research | Aomi",
            names: { robots: "noindex, nofollow" },
          },
        });
        await check({
          path: taskApiPath,
          status: 200,
          headers: { "content-type": "text/html" },
          textIncludes: [
            taskApiTitle,
            "The Aomi Task API solves the first problem",
            "The price is $1 plus 3% of what moves.",
            "https://arc-canteen.aomi.dev/execution-kit",
            "/research/introducing-the-aomi-task-api/figures/architecture.png",
            "/research/introducing-the-aomi-task-api/figures/sequence.png",
            "/research/introducing-the-aomi-task-api/figures/pricing.png",
          ],
          head: {
            title: `${taskApiTitle} | Aomi Labs Research`,
            properties: {
              "og:type": "article",
              "article:published_time": "2026-10-11",
              "og:url": `https://aomi.dev${taskApiPath}`,
            },
          },
        });
        await check({
          path: taskApiPath,
          method: "HEAD",
          status: 200,
          bodyAbsent: true,
        });
        await check({ path: "/research/does-not-exist", status: 404 });
        // Both immutable Next optional catchalls use redirect() at the index.
        for (const [index, destination, title] of [
          ["/examples", "/examples/polymarket", "Polymarket"],
          ["/playground", "/playground/configurator", "Configurator"],
        ]) {
          for (const method of ["GET", "HEAD"])
            await check({
              path: index,
              method,
              status: 307,
              headers: { location: destination },
              ...(method === "HEAD" ? { bodyAbsent: true } : {}),
            });
          await check({
            path: destination,
            status: 200,
            headers: { "content-type": "text/html" },
            textIncludes: ["<html"],
            head: { title },
          });
          await check({
            path: destination,
            method: "HEAD",
            status: 200,
            bodyAbsent: true,
          });
        }
        // Fixed public upstreams are a separate observation, never a prerequisite
        // for the deterministic copied-artifact packaging proof.
        if (publicUpstreams) {
          await check({
            path: "/docs",
            status: 200,
            headers: { "content-type": "text/html" },
            textIncludes: ["<html", "Aomi"],
          });
          await check({
            path: "/brand.md",
            status: 200,
            headers: { ...cache, "content-type": "text/markdown" },
            textIncludes: ["Aomi"],
          });
        }
        await check({
          path: "/api/og",
          status: 200,
          headers: { "content-type": "image/png" },
          bytesPrefixHex: "89504e470d0a1a0a",
          timeoutMs: 30_000,
        });
        await check({
          path: "/api/proxy",
          status: 400,
          json: { error: "Missing ?url= parameter" },
        });
        await check({
          path: `/api/proxy?url=${encodeURIComponent(backend)}`,
          status: 403,
          json: { error: "Host not in allowlist" },
        });
        await check({
          path: "/api/account",
          status: 401,
          json: { error: "Authentication required" },
        });
        const requestHeaders = {
          cookie: "artifact-browser-cookie=must-not-forward",
          authorization: "Bearer invalid-artifact-browser-credential",
        };
        await check({
          path: "/api/thread/state",
          status: 200,
          requestHeaders,
          json: { thread_id: "copied-landing-thread", is_processing: false },
        });
        await check({
          path: "/api/thread/updates",
          status: 200,
          requestHeaders,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-transform",
          },
          stream: { minChunks: 2, maxFirstChunkMs: 800, minDurationMs: 1_200 },
        });
        for (const record of records) {
          assert.equal(
            record.cookie,
            undefined,
            `${record.path}: browser cookie reached upstream`,
          );
          assert.equal(
            record.authorization,
            undefined,
            `${record.path}: browser credential reached anonymous upstream`,
          );
        }
        assert.deepEqual(records.map((record) => record.path).sort(), [
          "/api/thread/state",
          "/api/thread/updates",
        ]);
        await check({
          path: "/api/widget-fixture/wallet-compound-borrow",
          status: 200,
          headers: { "cache-control": "no-store" },
          json: { fixture: "wallet-compound-borrow", path: "" },
        });
        await check({
          path: "/api/widget-fixture/wallet-compound-borrow/api/thread/state",
          status: 200,
          headers: { "cache-control": "no-store" },
          json: {
            thread_id: "widget-fixture-wallet-compound-borrow",
            is_processing: true,
          },
        });
        await check({
          path: "/api/widget-fixture/wallet-compound-borrow/api/threads",
          method: "POST",
          body: {},
          status: 200,
          headers: { "cache-control": "no-store" },
          json: { thread_id: "widget-fixture-wallet-compound-borrow" },
        });
      },
    });
  } finally {
    await new Promise((done) => upstream.close(done));
  }
}

async function telegramArtifact(artifact, fixtureEnv) {
  await smokeStartArtifact({
    app: "telegram",
    artifact,
    env: fixtureEnv,
    async probe({ check }) {
      await check({
        path: "/",
        status: 200,
        headers: { "content-type": "text/html" },
        textIncludes: [
          "Aomi Wallet",
          "Setting up your wallet…",
          "Verify Telegram",
        ],
      });
      for (const asset of nativeStaticAssets("telegram"))
        await check({
          path: asset.path,
          status: 200,
          bytesSha256: asset.sha256,
        });
      await check({ path: "/", method: "HEAD", status: 200, bodyAbsent: true });
      await check({ path: "/api/telegram/launch", status: 405 });
      await check({
        path: "/api/telegram/launch",
        method: "OPTIONS",
        status: 204,
        headers: { allow: "OPTIONS, POST" },
      });
      await check({
        path: "/api/telegram/launch/?migration=a%2Bb",
        method: "POST",
        body: {},
        status: 308,
        headers: { location: "/api/telegram/launch?migration=a%2Bb" },
      });
      const launch = (body, status, error) =>
        check({
          path: "/api/telegram/launch",
          method: "POST",
          body,
          status,
          headers: { "cache-control": "no-store" },
          json: { error },
        });
      await launch({}, 400, "malformed");
      const now = Math.floor(Date.now() / 1_000);
      const fields = new URLSearchParams({
        auth_date: String(now),
        user: JSON.stringify({ id: 900000000000001 }),
      });
      await launch(
        { botId: "900000001", initData: fields.toString() },
        400,
        "missing_signature",
      );
      fields.set("signature", Buffer.alloc(64).toString("base64url"));
      await launch(
        { botId: "900000001", initData: fields.toString() },
        401,
        "bad_signature",
      );
      fields.set("auth_date", String(now - 24 * 60 * 60 - 1));
      await launch(
        { botId: "900000001", initData: fields.toString() },
        401,
        "expired",
      );
    },
  });
}

export async function testStartArtifacts(args = process.argv.slice(2)) {
  register();
  const option = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const apps = option("--app") ? [option("--app")] : artifactApps;
  if (apps.some((app) => !artifactApps.includes(app)))
    throw new Error("--app must be portal, build, landing or telegram");
  const env = artifactFixtureEnvironment();
  if (
    !env.AOMI_ARTIFACT_SECRET_CANARY ||
    env.AOMI_ARTIFACT_SECRET_CANARY.length < 16
  )
    throw new Error(
      "Set the same AOMI_ARTIFACT_SECRET_CANARY used for the production build",
    );
  if (args.includes("--vercel-output")) {
    if (apps.length !== 1)
      throw new Error("Select one --app with --vercel-output");
    verifyVercelArtifact({
      app: apps[0],
      artifact: option("--vercel-output"),
      secretCanary: env.AOMI_ARTIFACT_SECRET_CANARY,
      assets: nativeStaticAssets(apps[0]),
    });
    return;
  }
  const outputs = Object.fromEntries(
    apps.map((app) => [
      app,
      resolve(option(`--${app}-output`, `apps/${app}/.output`)),
    ]),
  );
  for (const app of apps)
    if (!existsSync(join(outputs[app], "server/index.mjs")))
      throw new Error(
        `Build the ${app} Nitro Node artifact before running this check`,
      );
  const probes = {
    portal: portalArtifact,
    build: buildArtifact,
    landing: landingArtifact,
    telegram: telegramArtifact,
  };
  for (const app of apps)
    await probes[app](outputs[app], env, args.includes("--public-upstreams"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await testStartArtifacts();
