// Production hosts for the browser suites: the fake upstream, a production
// Portal on a disposable database, and the packed widget consumers built from
// this checkout's tarballs. Each runner starts what it needs and stops it all.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const { startAgentUpstream } =
  await import("../tests/e2e/fake-backend/upstream.ts");
const { portalEnv } = await import("../tests/e2e/portal-env.ts");

export const root = fileURLToPath(new URL("../", import.meta.url));

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Owns every process, server and folder a runner starts; `stop` ends them all. */
export function createHosts(output) {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const logPath = join(output, "hosts.log");
  writeFileSync(logPath, "");
  const stops = [];
  const log = (text) => appendFileSync(logPath, redact(String(text)));
  const hosts = {
    log,
    async run(bin, args, env = process.env, cwd = root) {
      log(`> ${bin} ${args.join(" ")}\n`);
      const child = spawn(bin, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", log);
      child.stderr.on("data", log);
      const code = await exitOf(child);
      if (code !== 0)
        throw new Error(`${bin} ${args.join(" ")} failed; see ${logPath}`);
    },
    async serve(label, bin, args, { cwd = root, env, origin }) {
      const child = spawn(bin, args, {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => log(`${label}: ${chunk}`));
      child.stderr.on("data", (chunk) => log(`${label}: ${chunk}`));
      stops.push(() => killGroup(child));
      await waitForHttp(origin, child);
    },
    temporaryDirectory(prefix) {
      const directory = mkdtempSync(join(tmpdir(), prefix));
      stops.push(() => rmSync(directory, { recursive: true, force: true }));
      return directory;
    },
    onStop(stop) {
      stops.push(stop);
    },
    async stop() {
      for (const stop of stops.reverse()) await stop();
      stops.length = 0;
    },
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void hosts.stop().finally(() => process.exit(130));
    });
  return hosts;
}

/** Fake upstream, packed Vite consumer and production Portal. */
export async function startPortalHosts(hosts, upstreamOptions = {}) {
  const trustedBase = required("CONSUMER_BASE_SHA");
  const databaseUrl = required("AOMI_TEST_DATABASE_URL");
  if (process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1")
    throw new Error(
      "AOMI_TEST_DATABASE_DISPOSABLE=1 must mark the database as disposable",
    );
  const [portalPort, consumerPort, nextPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const origins = {
    portal: `http://127.0.0.1:${portalPort}`,
    consumer: `http://127.0.0.1:${consumerPort}`,
    // Same port on another loopback address: an origin the Portal never allowed.
    rejectedConsumer: `http://127.0.0.2:${consumerPort}`,
    next: `http://127.0.0.1:${nextPort}`,
  };
  const upstream = await startAgentUpstream(upstreamOptions);
  hosts.onStop(() => upstream.close());
  const env = {
    ...process.env,
    ...portalEnv({
      portal: origins.portal,
      upstream: upstream.origin,
      databaseUrl,
      embedOrigins: [origins.consumer, origins.next],
    }),
    NODE_ENV: "production",
  };
  const consumerRecord = join(
    hosts.temporaryDirectory("aomi-consumer-record-"),
    "consumer.json",
  );
  await hosts.run(
    "node",
    [
      "scripts/check-consumer-compatibility.mjs",
      "--base",
      trustedBase,
      "--only-widget",
      "--browser-output",
      consumerRecord,
    ],
    {
      ...env,
      VITE_AOMI_API_URL: origins.portal,
      VITE_AOMI_APPLICATION_ID: "1",
    },
  );
  const consumer = JSON.parse(readFileSync(consumerRecord, "utf8"));
  hosts.onStop(() =>
    rmSync(resolve(consumer.consumerDirectory, "../.."), {
      recursive: true,
      force: true,
    }),
  );
  // Account auth imports the client package built by the compatibility check.
  await hosts.run(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsx",
      "apps/portal/scripts/migrate-browser-contract-db.ts",
    ],
    env,
  );
  const consumerServer = await serveStatic(
    join(consumer.consumerDirectory, "dist"),
    consumerPort,
  );
  hosts.onStop(() => new Promise((done) => consumerServer.close(done)));

  await hosts.run("corepack", ["pnpm", "--filter", "portal", "build"], env);
  await hosts.serve("portal", process.execPath, [".output/server/index.mjs"], {
    cwd: join(root, "apps/portal"),
    env: { ...env, HOST: "127.0.0.1", PORT: String(portalPort) },
    origin: origins.portal,
  });
  return {
    origins,
    upstream: upstream.origin,
    env,
    trustedBase: consumer.trustedBase,
  };
}

/** A fresh Next.js app installed from the packed widget, served on `origins.next`. */
export async function startNextConsumer(hosts, portal) {
  const { prepareFreshNextConsumer } =
    await import("./prepare-fresh-widget-next.mjs");
  const install = await prepareFreshNextConsumer({
    apiUrl: portal.origins.portal,
    outputDirectory: hosts.temporaryDirectory("aomi-fresh-widget-next-"),
  });
  const env = {
    ...portal.env,
    NEXT_PUBLIC_AOMI_API_URL: portal.origins.portal,
    NEXT_PUBLIC_AOMI_APPLICATION_ID: "1",
  };
  const directory = install.nextConsumerDirectory;
  await hosts.run(
    "corepack",
    ["pnpm", "--dir", directory, "exec", "next", "build"],
    env,
  );
  await hosts.serve(
    "next consumer",
    process.execPath,
    [
      join(directory, "node_modules/next/dist/bin/next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      new URL(portal.origins.next).port,
    ],
    { cwd: directory, env, origin: portal.origins.next },
  );
}

/** Runs Playwright, then fails on any failure, skip, flake or missing test. */
export async function playwright(hosts, args, env, minimumPassed) {
  const report = join(root, "output/playwright", `report-${process.pid}.json`);
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "playwright", "test", ...args, "--reporter=list,json"],
    {
      cwd: root,
      env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
      stdio: "inherit",
    },
  );
  hosts.onStop(() => child.kill("SIGTERM"));
  const code = await exitOf(child);
  const stats = existsSync(report)
    ? JSON.parse(readFileSync(report, "utf8")).stats
    : null;
  rmSync(report, { force: true });
  if (
    code !== 0 ||
    !stats ||
    stats.expected < minimumPassed ||
    stats.unexpected ||
    stats.skipped ||
    stats.flaky
  )
    throw new Error(
      `Playwright failed or ran fewer than ${minimumPassed} tests (exit=${code}, stats=${JSON.stringify(stats)})`,
    );
}

function redact(value) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /(?:better-auth\.session_token|aomi_wst_[A-Za-z0-9_-]+)=[^;\s"']+/gi,
      "session=[redacted]",
    )
    .replace(
      /(?:password|secret|token|private[_ -]?key)\s*[:=]\s*[^\s,"']+/gi,
      "credential=[redacted]",
    );
}

function exitOf(child) {
  return new Promise((done) => child.on("exit", (code) => done(code ?? 1)));
}

function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already stopped.
  }
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function waitForHttp(origin, child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`${origin} exited before it was ready`);
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(2_000) })).ok)
        return;
    } catch {
      // Still starting.
    }
    await delay(500);
  }
  throw new Error(`${origin} was not ready within 3 minutes`);
}

async function serveStatic(directory, port) {
  const types = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
  };
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://static.invalid").pathname,
    );
    const path = resolve(
      directory,
      normalize(pathname === "/" ? "index.html" : pathname.slice(1)),
    );
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
      types[extname(path)] ?? "application/octet-stream",
    );
    response.end(readFileSync(path));
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    // 0.0.0.0 so the same port also answers on 127.0.0.2, the rejected origin.
    server.listen(port, "0.0.0.0", done);
  });
  return server;
}
