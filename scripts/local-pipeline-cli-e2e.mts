import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mintAgentApiBearer } from "../packages/account/src/index.ts";
import { AomiClient } from "../packages/client/src/index.ts";

const productRoot = process.env.AOMI_PRODUCT_ROOT;
assert.ok(productRoot, "AOMI_PRODUCT_ROOT must name the backend checkout");

const portalOrigin =
  process.env.AOMI_PIPELINE_E2E_ORIGIN ?? "http://127.0.0.1:8082";
const userId =
  process.env.AOMI_PIPELINE_E2E_USER_ID ??
  "11111111-1111-4111-8111-111111111111";
const fixture = readFileSync(
  join(productRoot, "aomi/bin/api-server/src/auth.rs"),
  "utf8",
).match(
  /const BFF_PRIVATE: &\[u8\] = b"([\s\S]*?-----END PRIVATE KEY-----\n)";/,
);
assert.ok(fixture, "the development issuer fixture is missing");
process.env.PORTAL_SERVICE_PRIVATE_KEY = fixture[1];

const { bearer } = await mintAgentApiBearer(userId, {
  scope: "pipeline:catalog",
  resource: `${portalOrigin}/v1/pipeline`,
  client_id: "pipeline-cli-e2e",
  auth_source: "oauth",
  principal_class: "user",
  grant_id: "pipeline-cli-e2e",
});
const oauth = async () => ({
  accessToken: bearer,
  expiresAt: Number.MAX_SAFE_INTEGER,
  resource: "pipeline",
  scopes: ["pipeline:read"],
  tokenType: "Bearer" as const,
});
const client = new AomiClient({
  baseUrl: portalOrigin,
  guest: false,
  oauth,
});

const root = await client.pipeline.root();
const apps = await client.pipeline.apps.list();
const defaultApp = await client.pipeline.app("default").directory();
assert.ok(root.entries.length > 0, "Pipeline root is empty");
assert.ok(apps.entries.some((entry) => entry.name === "default"));
assert.ok(defaultApp.entries.length > 0, "default Pipeline app is empty");

const cli = spawnSync(
  process.execPath,
  [
    "packages/client/dist/cli.js",
    "pipeline",
    "apps",
    "--backend-url",
    portalOrigin,
    "--json",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, AOMI_ACCOUNT_BEARER: bearer },
  },
);
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
assert.match(cli.stdout, /"default"/, "CLI omitted the default Pipeline app");

console.log(
  JSON.stringify({
    result: "pass",
    pipelineRootEntries: root.entries.length,
    pipelineApps: apps.entries.length,
    defaultOperations: defaultApp.entries.length,
    cli: "pipeline apps",
  }),
);
