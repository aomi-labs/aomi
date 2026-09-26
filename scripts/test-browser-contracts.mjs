#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const portalRequire = createRequire(
  new URL("../apps/portal/package.json", import.meta.url),
);
const { importSPKI, jwtVerify } = await import(
  pathToFileURL(portalRequire.resolve("jose")).href
);
const { privateKeyToAccount } = await import("viem/accounts");

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "output/playwright/browser-contracts");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const resultsPath = join(output, "results.json");
const consumerManifestPath = join(output, "consumer.json");
const logPath = join(output, "harness.log");
writeFileSync(logPath, "");

for (const prerequisite of [
  join(root, "node_modules/next/dist/bin/next"),
  join(root, "node_modules/.bin/tsx"),
  chromium.executablePath(),
]) {
  if (!existsSync(prerequisite)) {
    throw new Error(`Browser contract prerequisite missing: ${prerequisite}`);
  }
}

const [portalPort, consumerPort, upstreamPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
]);
const portalOrigin = `http://127.0.0.1:${portalPort}`;
const consumerOrigin = `http://127.0.0.1:${consumerPort}`;
const rejectedConsumerOrigin = `http://127.0.0.2:${consumerPort}`;
const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
const container = `aomi-browser-contract-${process.pid}`;
const trustedBase = process.env.CONSUMER_BASE_SHA;
if (!trustedBase) {
  throw new Error(
    "CONSUMER_BASE_SHA must identify the immutable consumer baseline",
  );
}
if (process.env.CI && process.env.UPDATE_BROWSER_SNAPSHOTS === "1") {
  throw new Error("CI cannot update committed browser snapshots");
}

const fixtureBytes = (label) =>
  createHash("sha256").update(`aomi-browser-contract:${label}`).digest();
const evmPrivateKeys = ["evm-1", "evm-2"].map(
  (label) => `0x${fixtureBytes(label).toString("hex")}`,
);
const evmAddresses = evmPrivateKeys.map(
  (privateKey) => privateKeyToAccount(privateKey).address,
);
const svmSeed = JSON.stringify([...fixtureBytes("svm-1")]);
const fixturePrivateKey =
  "-----BEGIN PRIVATE KEY-----\n" +
  "MC4CAQAwBQYDK2VwBCIEIA3YGS2n6pAbisXZxFbDPdncGRxMXI2m4eJN2gNSf+wi\n" +
  "-----END PRIVATE KEY-----";
const resourceFixtureUri =
  "aomi://browser-contract/staged-transactions/0123456789abcdef0123456789abcdef";
const resourceFixtureText =
  "Retained scoped text <script>window.resourceTextExecuted = true</script>";

let postgresPort;
let nextProcess;
let playwrightProcess;
let consumerDirectory;
let cleaned = false;
const servers = [];

const redact = (value) =>
  value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /(?:better-auth\.session_token|aomi_wst_[A-Za-z0-9_-]+)=[^;\s"']+/gi,
      "session=[redacted]",
    )
    .replace(
      /(?:password|secret|token|private[_ -]?key)\s*[:=]\s*[^\s,"']+/gi,
      "credential=[redacted]",
    );

function log(value) {
  appendFileSync(logPath, redact(String(value)));
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of [playwrightProcess, nextProcess]) {
    if (!child) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  for (const server of servers) server.close();
  if (consumerDirectory) {
    const temporaryRoot = resolve(consumerDirectory, "../..");
    if (temporaryRoot.startsWith(resolve(tmpdir(), "aomi-consumer-compat-"))) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  spawnSync("docker", ["stop", "--timeout", "1", container], {
    stdio: "ignore",
    timeout: 5_000,
  });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  await startPostgres();
  const databaseUrl = `postgresql://fixture:fixture@127.0.0.1:${postgresPort}/fixture`;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    BETTER_AUTH_URL: portalOrigin,
    AOMI_PORTAL_BASE_URL: portalOrigin,
    AOMI_AUTH_DOMAIN: new URL(portalOrigin).host,
    AOMI_TRUSTED_ORIGINS: `${portalOrigin},${consumerOrigin}`,
    BETTER_AUTH_SECRET: "browser-contract-secret-at-least-32-bytes",
    DATABASE_URL: databaseUrl,
    AOMI_TEST_DATABASE_URL: databaseUrl,
    AOMI_TEST_DATABASE_DISPOSABLE: "1",
    PORTAL_SERVICE_PRIVATE_KEY: fixturePrivateKey,
    NEXT_PUBLIC_BACKEND_URL: "/",
    AOMI_PROXY_BACKEND_URL: upstreamOrigin,
    AOMI_AGENT_API_URL: upstreamOrigin,
    AOMI_GUEST_AGENT_REST_ENABLED: "1",
    NEXT_PUBLIC_PROJECT_ID: "000000000000000000000000000000000000000000",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      "000000000000000000000000000000000000000000",
    NEXT_PUBLIC_PARA_API_KEY: "ci-fixture-not-a-secret",
    NEXT_PUBLIC_PARA_ENVIRONMENT: "BETA",
    NEXT_TELEMETRY_DISABLED: "1",
    BROWSER_CONTRACT_PORTAL_URL: portalOrigin,
    BROWSER_CONTRACT_CONSUMER_URL: consumerOrigin,
    BROWSER_CONTRACT_REJECTED_CONSUMER_URL: rejectedConsumerOrigin,
    BROWSER_CONTRACT_UPSTREAM_URL: upstreamOrigin,
    BROWSER_CONTRACT_EVM_PRIVATE_KEYS: evmPrivateKeys.join(","),
    BROWSER_CONTRACT_SVM_SEED: svmSeed,
  };

  const upstream = await createControlledUpstream(upstreamPort);
  servers.push(upstream);

  await run(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsx",
      "apps/portal/scripts/migrate-browser-contract-db.ts",
    ],
    { env },
  );

  await run(
    "node",
    [
      "scripts/check-consumer-compatibility.mjs",
      "--base",
      trustedBase,
      "--only-widget",
      "--browser-output",
      "output/playwright/browser-contracts/consumer.json",
    ],
    {
      env: {
        ...env,
        VITE_AOMI_API_URL: portalOrigin,
        VITE_AOMI_APPLICATION_ID: "1",
      },
    },
  );
  const consumerManifest = JSON.parse(
    readFileSync(consumerManifestPath, "utf8"),
  );
  consumerDirectory = consumerManifest.consumerDirectory;
  if (
    consumerManifest.trustedBase !== resolveCommit(trustedBase) ||
    consumerManifest.immutableSource !== "apps/widget-consumer" ||
    !existsSync(join(consumerDirectory, "dist/index.html"))
  ) {
    throw new Error(
      "Packaged widget consumer baseline was not prepared exactly",
    );
  }

  await run("corepack", ["pnpm", "--filter", "portal", "build"], { env });
  if (!existsSync(join(root, "apps/portal/.next/BUILD_ID"))) {
    throw new Error("Production Portal build emitted no BUILD_ID");
  }

  const consumer = await createStaticServer(
    join(consumerDirectory, "dist"),
    consumerPort,
  );
  servers.push(consumer);

  nextProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(portalPort),
    ],
    {
      cwd: join(root, "apps/portal"),
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [nextProcess.stdout, nextProcess.stderr]) {
    stream.on("data", (chunk) => log(chunk.toString()));
  }
  await waitForHttp(portalOrigin, 120_000, () => nextProcess?.exitCode);
  await waitForHttp(consumerOrigin, 20_000);

  writeFileSync(resultsPath, "");
  playwrightProcess = spawn(
    "corepack",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--project=browser-contracts",
      "--workers=1",
      "--reporter=list,html,json",
      ...(process.env.BROWSER_CONTRACT_FOCUS === "working-text-growth"
        ? ["--grep=controlled delayed child activity"]
        : process.env.BROWSER_CONTRACT_FOCUS === "transaction-progress"
          ? ["--grep=unfinished callback transactions"]
          : []),
      ...(process.env.UPDATE_BROWSER_SNAPSHOTS === "1"
        ? ["--update-snapshots"]
        : []),
    ],
    {
      cwd: root,
      env: {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: resultsPath,
        PLAYWRIGHT_HTML_OUTPUT_DIR: join(output, "report"),
        PLAYWRIGHT_HTML_OPEN: "never",
      },
      detached: true,
      stdio: "inherit",
    },
  );
  const code = await new Promise((resolveExit) =>
    playwrightProcess.on("exit", (value) => resolveExit(value ?? 1)),
  );
  playwrightProcess = undefined;
  const stats = existsSync(resultsPath)
    ? JSON.parse(readFileSync(resultsPath, "utf8")).stats
    : null;
  if (
    code !== 0 ||
    !stats ||
    stats.expected !==
      (["working-text-growth", "transaction-progress"].includes(
        process.env.BROWSER_CONTRACT_FOCUS,
      )
        ? 1
        : 17) ||
    stats.skipped !== 0 ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0
  ) {
    throw new Error(
      `Browser contract suite failed or omitted mandatory scenarios (expected=${["working-text-growth", "transaction-progress"].includes(process.env.BROWSER_CONTRACT_FOCUS) ? 1 : 17}, exit=${code}, stats=${JSON.stringify(stats)})`,
    );
  }
  console.log(
    `Browser contract suites passed (${stats.expected} required tests, trusted consumer ${consumerManifest.trustedBase}).`,
  );
} finally {
  cleanup();
}

async function startPostgres() {
  const docker = spawn(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=fixture",
      "-e",
      "POSTGRES_USER=fixture",
      "-e",
      "POSTGRES_DB=fixture",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const started = await collect(docker);
  if (started.code !== 0) {
    throw new Error(`Isolated Postgres failed to start: ${started.output}`);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const mapped = await command("docker", ["port", container, "5432/tcp"]);
    const match = mapped.output.match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      postgresPort = Number(match[1]);
      break;
    }
    await delay(250);
  }
  if (!postgresPort) throw new Error("Isolated Postgres has no mapped port");
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await command("docker", [
      "exec",
      container,
      "pg_isready",
      "-U",
      "fixture",
      "-d",
      "fixture",
    ]);
    if (ready.code === 0) return;
    await delay(500);
  }
  throw new Error("Isolated Postgres was not ready within 30 seconds");
}

async function run(bin, args, options = {}) {
  log(`> ${bin} ${args.join(" ")}\n`);
  const child = spawn(bin, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => log(chunk.toString()));
  }
  const result = await collect(child);
  if (result.code !== 0) {
    throw new Error(
      `${bin} ${args[0] ?? ""} failed; see sanitized harness log`,
    );
  }
}

function command(bin, args, options = {}) {
  const child = spawn(bin, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return collect(child);
}

async function collect(child) {
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += chunk;
    });
  }
  const code = await new Promise((resolveExit) =>
    child.on("exit", (value) => resolveExit(value ?? 1)),
  );
  return { code, output };
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHttp(origin, timeoutMs, exitCode = () => null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitCode() !== null)
      throw new Error(`${origin} exited before readiness`);
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Startup in progress.
    }
    await delay(500);
  }
  throw new Error(`${origin} did not become ready within ${timeoutMs}ms`);
}

function resolveCommit(value) {
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", `${value}^{commit}`],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`Invalid trusted base ${value}`);
  return result.stdout.trim();
}

async function createStaticServer(directory, port) {
  const mime = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
  };
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://fixture").pathname,
    );
    const candidate = normalize(
      pathname === "/" ? "index.html" : pathname.slice(1),
    );
    const path = resolve(directory, candidate);
    if (
      !path.startsWith(resolve(directory)) ||
      !existsSync(path) ||
      !statSync(path).isFile()
    ) {
      response.writeHead(404).end("not found");
      return;
    }
    response.setHeader(
      "content-type",
      mime[extname(path)] ?? "application/octet-stream",
    );
    response.end(readFileSync(path));
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolveListen);
  });
  return server;
}

async function createControlledUpstream(port) {
  const topology = readFileSync(
    join(root, "packages/account/src/topology-data.ts"),
    "utf8",
  );
  const publicKey = topology.match(
    /name = "aomi-bff"[\s\S]*?public_key = """\n([\s\S]*?)\n"""/,
  )?.[1];
  if (!publicKey)
    throw new Error("Could not read the committed dev BFF public key");
  const verificationKey = await importSPKI(publicKey, "EdDSA");
  const records = [];
  const threads = new Map();
  let eventSequence = 0;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, upstreamOrigin);
      if (url.pathname === "/__records") {
        return json(response, 200, { records });
      }
      if (url.pathname === "/__reset" && request.method === "POST") {
        records.length = 0;
        threads.clear();
        eventSequence = 0;
        return json(response, 204, undefined);
      }
      if (url.pathname === "/api/account" && request.method === "GET") {
        const principal = await verifyPrincipal(
          request,
          verificationKey,
          "aomi-backend",
        );
        records.push(recordFor(request, url, principal));
        if (!principal)
          return json(response, 401, { error: { code: "invalid_token" } });
        const now = Math.floor(Date.now() / 1000);
        return json(response, 200, {
          user: {
            user_id: principal.sub,
            username: null,
            apps: [],
            tier: "free",
            verified_email: null,
            status: "active",
            last_seen_at: now,
            created_at: now,
            updated_at: now,
          },
          auth_providers: [],
          user_accounts: [],
          signing_policies: [],
          delegated_accounts: [],
          operating_accounts: [],
          onchain_policy_bindings: [],
        });
      }
      if (url.pathname.startsWith("/api/")) {
        records.push(recordFor(request, url, null));
        if (url.pathname.endsWith("/models"))
          return json(response, 200, ["fixture-model"]);
        if (url.pathname.endsWith("/apps"))
          return json(response, 200, [{ name: "default", is_public: true }]);
        if (url.pathname === "/api/resource/skills")
          return json(response, 200, { skills: [] });
        return json(response, 404, { error: "fixture_route_not_found" });
      }
      const principal = await verifyPrincipal(request, verificationKey);
      records.push(recordFor(request, url, principal));
      if (!principal)
        return json(response, 401, { error: { code: "invalid_token" } });

      if (url.pathname === "/v1/agent/error-fixture") {
        response.setHeader("retry-after", "7");
        response.setHeader("x-request-id", "fixture-error-request");
        return json(response, 429, { error: { code: "fixture_limited" } });
      }
      if (
        url.pathname === "/v1/account/statement" &&
        request.method === "GET"
      ) {
        return json(response, 200, {
          entries: [
            {
              usage_event_id: "fixture-usage-1",
              execution_id: "fixture-operation-1",
              application_id: null,
              provider: "openai",
              model: "fixture-model",
              input_tokens: 1200,
              output_tokens: 300,
              funding: { kind: "platform", application_id: null },
              gross: 125_000,
              included: 100_000,
              credits: 25_000,
              details: {},
              occurred_at: 1_700_000_000,
            },
          ],
          next_cursor: null,
        });
      }
      if (url.pathname === "/v1/account/credits" && request.method === "GET") {
        return json(response, 200, {
          period_utc_month: "2026-09",
          included_limit: 10_000_000,
          included_used: 1_250_000,
          included_remaining: 8_750_000,
          balance: 25_000_000,
          outstanding_debt: 0,
          records: [],
          next_before_id: null,
        });
      }
      if (url.pathname === "/v1/agent/sessions" && request.method === "GET") {
        return json(response, 200, {
          sessions: [...threads.entries()]
            .filter(([, thread]) => thread.owner === principal.sub)
            .map(([id, thread]) => ({
              id,
              title: thread.prompt,
              updatedAt: thread.updatedAt,
              archived: false,
            })),
          nextCursor: null,
        });
      }
      if (url.pathname === "/v1/agent/chat" && request.method === "POST") {
        const body = JSON.parse((await bodyText(request)) || "{}");
        const sessionId = body.sessionId ?? body.session_id;
        if (typeof sessionId !== "string" || typeof body.message !== "string") {
          return json(response, 400, { error: { code: "invalid_request" } });
        }
        const turn = ++eventSequence;
        const events =
          body.message === "prepare the deterministic wallet review"
            ? actionFixtureEvents(turn, body.message, evmAddresses[0])
            : body.message === "inspect the retained resource contract"
              ? resourceFixtureEvents(turn, body.message)
              : [
                  event(turn, 1, "message", {
                    sender: "user",
                    content: body.message,
                  }),
                  event(turn, 2, "message", {
                    sender: "agent",
                    content: `Controlled reply for ${body.message}`,
                  }),
                  event(turn, 3, "turn_state_changed", { state: "complete" }),
                ];
        threads.set(sessionId, {
          owner: principal.sub,
          prompt: body.message,
          updatedAt: Date.now(),
          events,
        });
        response.setHeader("x-request-id", `fixture-turn-${turn}`);
        return json(response, 200, {
          session_id: sessionId,
          cursor: "3",
          events,
          has_more: false,
        });
      }
      const resourceRead = url.pathname.match(
        /^\/v1\/agent\/sessions\/([^/]+)\/resources\/read$/,
      );
      if (resourceRead && request.method === "GET") {
        const thread = threads.get(decodeURIComponent(resourceRead[1]));
        if (
          !thread ||
          thread.owner !== principal.sub ||
          url.searchParams.get("uri") !== resourceFixtureUri
        ) {
          return json(response, 404, { error: { code: "resource_not_found" } });
        }
        response.setHeader("cache-control", "no-store");
        return json(response, 200, {
          resource: {
            uri: resourceFixtureUri,
            kind: "evm.staged-transaction@1",
            mime_type: "text/plain",
            name: "Retained EVM transfer",
            byte_length: Buffer.byteLength(resourceFixtureText),
            digest: createHash("sha256")
              .update(resourceFixtureText)
              .digest("hex"),
            created_at: "2026-09-26T00:00:00Z",
            expires_at: null,
            action_expires_at: null,
          },
          view: "content",
          summary: { count: 1 },
          content: { encoding: "text", data: resourceFixtureText },
          children: [],
          complete: true,
        });
      }
      const poll = url.pathname.match(/^\/v1\/agent\/chat\/([^/]+)$/);
      if (poll && request.method === "GET") {
        const thread = threads.get(decodeURIComponent(poll[1]));
        if (!thread || thread.owner !== principal.sub) {
          return json(response, 404, { error: { code: "session_not_found" } });
        }
        return json(response, 200, {
          session_id: decodeURIComponent(poll[1]),
          cursor: "3",
          events: url.searchParams.has("cursor") ? [] : thread.events,
          has_more: false,
        });
      }
      const actionResult = url.pathname.match(
        /^\/v1\/agent\/chat\/([^/]+)\/actions\/([^/]+)\/result$/,
      );
      if (actionResult && request.method === "POST") {
        const sessionId = decodeURIComponent(actionResult[1]);
        const actionId = decodeURIComponent(actionResult[2]);
        const thread = threads.get(sessionId);
        if (!thread || thread.owner !== principal.sub) {
          return json(response, 404, { error: { code: "session_not_found" } });
        }
        const body = JSON.parse((await bodyText(request)) || "{}");
        const idempotencyKey = request.headers["idempotency-key"];
        const replay = idempotencyKey
          ? thread.actionResults?.get(idempotencyKey)
          : undefined;
        if (replay) return json(response, 200, replay);
        const index = thread.events.findIndex(
          (entry) => entry.type === "action" && entry.id === actionId,
        );
        const current = thread.events[index];
        if (!current) {
          return json(response, 404, { error: { code: "action_not_found" } });
        }
        if (body.revision !== current.revision || current.state !== "pending") {
          return json(response, 409, {
            error: { code: "stale_action_revision" },
          });
        }
        const next = {
          ...current,
          revision: current.revision + 1,
          state:
            body.result?.status === "rejected"
              ? "rejected"
              : body.result?.status === "submitted"
                ? "submitted"
                : "completed",
          result: body.result,
        };
        thread.events[index] = next;
        thread.events = [
          ...thread.events.filter(
            (entry) =>
              !(
                entry.type === "turn_state_changed" &&
                entry.state === "awaiting_action"
              ),
          ),
          event(turnFor(next), 5, "turn_state_changed", { state: "complete" }),
        ];
        const payload = { action: next };
        thread.actionResults ??= new Map();
        if (idempotencyKey) thread.actionResults.set(idempotencyKey, payload);
        return json(response, 200, payload);
      }
      if (/^\/v1\/agent\/chat\/[^/]+\/stream$/.test(url.pathname)) {
        response.writeHead(200, { "content-type": "text/event-stream" }).end();
        return;
      }
      const session = url.pathname.match(/^\/v1\/agent\/sessions\/([^/]+)$/);
      if (session && request.method === "PATCH") {
        const thread = threads.get(decodeURIComponent(session[1]));
        if (!thread || thread.owner !== principal.sub) {
          return json(response, 404, { error: { code: "session_not_found" } });
        }
        return json(response, 200, {
          id: decodeURIComponent(session[1]),
          title: thread.prompt,
          updatedAt: thread.updatedAt,
          archived: false,
        });
      }
      return json(response, 404, {
        error: { code: "fixture_route_not_found" },
      });
    } catch (error) {
      log(`upstream error: ${error instanceof Error ? error.stack : error}\n`);
      return json(response, 500, { error: { code: "fixture_failure" } });
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  return server;
}

async function verifyPrincipal(request, key, audience = "aomi-api-server") {
  const authorization = request.headers.authorization ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer: "aomi-bff",
      audience,
    });
    if (protectedHeader.kid !== "aomi-bff-dev-1" || payload.role !== "user") {
      return null;
    }
    return {
      sub: payload.sub,
      iss: payload.iss,
      aud: payload.aud,
      role: payload.role,
      scope: payload.scope,
      resource: payload.resource,
      auth_source: payload.auth_source,
      principal_class: payload.principal_class,
      sid: payload.sid,
      kid: protectedHeader.kid,
    };
  } catch {
    return null;
  }
}

function recordFor(request, url, principal) {
  const headers = Object.fromEntries(
    Object.entries(request.headers)
      .filter(([name]) => name !== "authorization" && name !== "cookie")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    method: request.method,
    path: url.pathname,
    query: url.search,
    headers,
    authorization: request.headers.authorization
      ? "verified-bff-bearer"
      : "absent",
    cookie: request.headers.cookie ? "present" : "absent",
    principal,
  };
}

function event(turn, sequence, type, data) {
  return {
    turn_id: `turn-${turn}`,
    event_id: `turn-${turn}-${sequence}`,
    occurred_at: Date.now() / 1000,
    sequence,
    type,
    ...data,
  };
}

function resourceFixtureEvents(turn, prompt) {
  return [
    event(turn, 1, "message", { sender: "user", content: prompt }),
    event(turn, 2, "message", {
      sender: "agent",
      content: "",
      tool_call_id: `resource-call-${turn}`,
      tool_name: "evm_stage_tx",
      tool_arguments: { source: { uri: resourceFixtureUri } },
      tool_result: [
        "evm_stage_tx",
        JSON.stringify({
          pending_tx_id: 7,
          chain_id: 8453,
          from: "0x0000000000000000000000000000000000000001",
          to: "0x0000000000000000000000000000000000000002",
          value: "1",
          data: "0x",
          label: "Retained EVM transfer",
          kind: "native_transfer",
          current_lifecycle: "queued",
        }),
      ],
      model_output: {
        resource: {
          uri: resourceFixtureUri,
          kind: "evm.staged-transaction@1",
          name: "Retained EVM transfer",
        },
        summary: { action: "stage", transaction_count: 1, chain_id: 8453 },
        resources: {},
      },
    }),
    event(turn, 3, "message", {
      sender: "agent",
      content: `Controlled reply for ${prompt}`,
    }),
    event(turn, 4, "turn_state_changed", { state: "complete" }),
  ];
}

function actionFixtureEvents(turn, prompt, from) {
  return [
    event(turn, 1, "message", { sender: "user", content: prompt }),
    event(turn, 2, "message", {
      sender: "agent",
      content:
        "Review the simulated transfer before handing it to your wallet.",
    }),
    {
      ...event(turn, 3, "action", {}),
      id: `fixture-action-${turn}`,
      revision: 1,
      state: "pending",
      request: {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 84532,
            from,
            to: "0x000000000000000000000000000000000000dEaD",
            value: "1",
            data: "0x",
            label: "Send 1 wei",
            kind: "transfer",
            broadcaster: "wallet",
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [
            {
              account: from,
              asset: "native",
              amount: "1",
              direction: "out",
              symbol: "ETH",
              standard: "native",
              chainId: 84532,
            },
          ],
          approvals: [],
          fees: [],
          gas: {
            units: "21000",
            priceWei: "1000000000",
            nativeCost: "21000000000000",
          },
          guards: [],
          logs: [],
          warnings: [],
        },
      },
      result: null,
      created_at: 1_700_000_000,
      expires_at: null,
    },
    event(turn, 4, "turn_state_changed", { state: "awaiting_action" }),
  ];
}

function turnFor(action) {
  return Number(String(action.turn_id).replace(/^turn-/, "")) || 0;
}

function bodyText(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000)
        reject(new Error("Fixture request too large"));
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function json(response, status, body) {
  response.statusCode = status;
  if (body !== undefined) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body));
  } else {
    response.end();
  }
}
