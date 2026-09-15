import { createServer } from "node:net";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}output/playwright/guest-regression`;
mkdirSync(output, { recursive: true });
for (const path of [
  `${root}node_modules/next/dist/bin/next`,
  `${root}node_modules/.bin/tsup`,
  chromium.executablePath(),
]) {
  if (!existsSync(path))
    throw new Error(`Guest browser prerequisite missing: ${path}`);
}

const port = await new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const address = socket.address();
    socket.close(() => resolve(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const container = `aomi-guest-browser-${process.pid}`;
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
const dockerExit = await new Promise((resolve) => {
  let output = "";
  docker.stdout.on("data", (chunk) => {
    output += chunk;
  });
  docker.stderr.on("data", (chunk) => {
    output += chunk;
  });
  docker.on("exit", (code) => resolve({ code, output }));
});
if (dockerExit.code !== 0)
  throw new Error(`Isolated Postgres failed to start: ${dockerExit.output}`);
async function command(bin, args, options = {}) {
  const child = spawn(bin, args, { cwd: root, ...options });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk) => {
      output += chunk;
    });
  const code = await new Promise((resolve) =>
    child.on("exit", (value) => resolve(value ?? 1)),
  );
  return { code, output };
}
let mappedPort;
for (let attempt = 0; attempt < 30; attempt++) {
  const mapped = await command("docker", ["port", container, "5432/tcp"]);
  const match = mapped.output.match(/127\.0\.0\.1:(\d+)/);
  if (match) {
    mappedPort = Number(match[1]);
    break;
  }
  await delay(500);
}
if (!mappedPort) {
  spawnSync("docker", ["stop", "--timeout", "1", container], {
    stdio: "ignore",
    timeout: 5_000,
  });
  throw new Error("Isolated Postgres has no mapped port");
}
const env = {
  ...process.env,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "guest-browser-test-secret-at-least-32-bytes",
  DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:${mappedPort}/fixture`,
  NEXT_PUBLIC_BACKEND_URL: "/",
  NEXT_PUBLIC_PROJECT_ID: "000000000000000000000000000000000000000000",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    "000000000000000000000000000000000000000000",
  NEXT_PUBLIC_PARA_API_KEY: "ci-fixture-not-a-secret",
  NEXT_PUBLIC_PARA_ENVIRONMENT: "BETA",
  AOMI_AGENT_API_URL: "http://127.0.0.1:1",
  AOMI_GUEST_AGENT_REST_ENABLED: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  GUEST_BROWSER_BASE_URL: origin,
};
let next;
let activeChild;
writeFileSync(`${output}/portal.log`, "");
const redact = (value) =>
  value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /(?:better-auth\.session_token|aomi_guest_browser_fixture)=[^;\s"']+/gi,
      "session=[redacted]",
    )
    .replace(
      /(?:password|secret|token|key)\s*[:=]\s*[^\s,"']+/gi,
      "credential=[redacted]",
    );
let completed = false;
const cleanup = () => {
  if (completed) return;
  completed = true;
  if (next) {
    try {
      process.kill(-next.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
  }
  if (activeChild) {
    try {
      activeChild.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }
  spawnSync("docker", ["stop", "--timeout", "1", container], {
    stdio: "ignore",
    timeout: 5_000,
  });
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
try {
  let databaseReady = false;
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
    if (ready.code === 0) {
      databaseReady = true;
      break;
    }
    await delay(500);
  }
  if (!databaseReady)
    throw new Error("Isolated Postgres was not ready within 30 seconds");
  const migrated = await command(
    "corepack",
    ["pnpm", "exec", "tsx", "apps/portal/scripts/migrate-guest-browser-db.ts"],
    { env },
  );
  appendFileSync(`${output}/portal.log`, redact(migrated.output));
  if (migrated.code !== 0)
    throw new Error(
      "Guest browser Better Auth migration failed; see sanitized log",
    );
  const packages = await command(
    "corepack",
    ["pnpm", "run", "build:packages"],
    { env },
  );
  appendFileSync(`${output}/portal.log`, redact(packages.output));
  if (
    packages.code !== 0 ||
    !existsSync(`${root}packages/client/dist/index.js`) ||
    !existsSync(`${root}packages/react/dist/index.js`) ||
    !existsSync(`${root}apps/shadcn-registry/dist/index.js`)
  ) {
    throw new Error(
      "Guest browser package prerequisites failed to build; see sanitized log",
    );
  }
  const built = await command(
    "corepack",
    ["pnpm", "--filter", "portal", "build"],
    { env },
  );
  appendFileSync(`${output}/portal.log`, redact(built.output));
  if (built.code !== 0 || !existsSync(`${root}apps/portal/.next/BUILD_ID`)) {
    throw new Error("Guest browser Portal build failed; see sanitized log");
  }
  next = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: `${root}apps/portal`,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [next.stdout, next.stderr])
    stream.on("data", (chunk) => {
      appendFileSync(`${output}/portal.log`, redact(chunk.toString()));
    });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (next.exitCode !== null)
      throw new Error(`Portal exited before readiness (${next.exitCode})`);
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup in progress */
    }
    await delay(1_000);
  }
  if (!ready) throw new Error("Portal did not become ready within 90 seconds");
  const results = `${output}/results.json`;
  writeFileSync(results, "");
  const test = spawn(
    "corepack",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--project=guest-regression",
      "--workers=1",
      "--reporter=list,html,json",
    ],
    {
      cwd: root,
      env: {
        ...env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: results,
        PLAYWRIGHT_HTML_OUTPUT_DIR: `${root}output/playwright/report`,
        PLAYWRIGHT_HTML_OPEN: "never",
      },
      stdio: "inherit",
    },
  );
  activeChild = test;
  const code = await new Promise((resolve) =>
    test.on("exit", (value) => resolve(value ?? 1)),
  );
  activeChild = undefined;
  const stats = existsSync(results)
    ? JSON.parse(readFileSync(results, "utf8")).stats
    : null;
  if (
    code !== 0 ||
    !stats ||
    stats.expected < 2 ||
    stats.skipped !== 0 ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0
  ) {
    throw new Error(
      `Guest browser suite failed or skipped required tests (exit=${code}, stats=${JSON.stringify(stats)})`,
    );
  }
} finally {
  cleanup();
}
