#!/usr/bin/env node
// Only an existing loopback PostgreSQL service is used. A random fixture base
// and each suite-owned database are removed; no workspace/hosted schema is changed.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: test-issuer-cutover.mjs <loopback-postgres-port>");
}
const url = new URL("postgresql://127.0.0.1/postgres");
url.port = String(port);
// Disposable local-service credentials, matching the repository's local test service.
url.username = "postgres";
url.password = "postgres";
const requireAccount = createRequire(
  new URL("../packages/account/package.json", import.meta.url),
);
const { Pool } = requireAccount("pg");
const admin = new Pool({ connectionString: url.toString() });
const database = `aomi_auth_loopback_test_${randomUUID().replaceAll("-", "")}`;
let created = false;
try {
  await admin.query(`create database "${database}"`);
  created = true;
  url.pathname = `/${database}`;
  const result = spawnSync("pnpm", ["exec", "vitest", "run", "apps/edge"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AOMI_AUTH_TEST_DATABASE_URL: url.toString(),
      AOMI_TEST_DATABASE_DISPOSABLE: "1",
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (created) await admin.query(`drop database "${database}" with (force)`);
  await admin.end();
}
