import { publicApiContract } from "./public-api-contract.mjs";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rustRepo = resolve(
  process.env.AOMI_RUST_REPO ?? join(root, "../product-mono/aomi"),
);
const source = join(root, "apps/portal/openapi/aomi-agent-v1.json");
const generated = join(root, "packages/client/src/generated/agent-v1/types.ts");
const generatedSchemas = join(
  root,
  "packages/client/src/generated/agent-v1/schemas.ts",
);
const serialized = publicApiContract(rustRepo);
const checkedIn = readFileSync(source, "utf8");
const current = JSON.stringify(JSON.parse(serialized));
if (current !== JSON.stringify(JSON.parse(checkedIn))) {
  console.error(
    "Rust Agent OpenAPI snapshot is stale. Run `pnpm generate:agent-api`.",
  );
  process.exit(1);
}

const expected = createHash("sha256").update(checkedIn).digest("hex");
const firstLine = readFileSync(generated, "utf8").split("\n", 1)[0];
if (firstLine !== `// Rust Agent contract SHA256: ${expected}`) {
  console.error(
    "Generated Agent API types are stale. Run `pnpm generate:agent-api`.",
  );
  process.exit(1);
}
const schemaFirstLine = readFileSync(generatedSchemas, "utf8").split(
  "\n",
  1,
)[0];
if (schemaFirstLine !== `// Rust Agent contract SHA256: ${expected}`) {
  console.error(
    "Generated Agent API runtime schemas are stale. Run `pnpm generate:agent-api`.",
  );
  process.exit(1);
}

const forbiddenSources = [
  ["retired chat route", /\/api\/thread\/(?:chat|state|interrupt)/],
  ["retired account route", /\/api\/aomi(?:\/|\b)/],
  ["retired widget auth route", /\/api\/widget\/auth(?:\/|\b)/],
  ["unversioned MCP resource", /(?<!\/v1)\/(?:agent|pipeline)\/mcp\b/],
  ["legacy Agent delta/activity type", /\bAgent(?:Delta|Activity)\b/],
  ["synthetic message type", /\bAomiMessage\b/],
  ["React event relay", /\bEventContext\b/],
  ["runtime UserState mirror", /\bRuntimeUserStateProvider\b/],
  ["legacy widget session type", /\bWidgetSession\b/],
  ["legacy wallet provider facade", /\bAomiWalletProvider\b/],
  ["legacy wallet adapter alias", /\bAomiAuthAdapter\b/],
  ["UserState reconciliation event", /\buser_state_updated\b/],
];
const sourceRoots = [
  "packages/client/src",
  "packages/react/src",
  "apps/portal/src",
  "apps/telegram/src",
  "packages/widget/src",
];
for (const relative of sourceRoots) {
  for (const file of sourceFiles(join(root, relative))) {
    // Negative contract tests deliberately name removed APIs.
    if (/\.(?:test|spec)\.tsx?$/.test(file)) continue;
    const contents = readFileSync(file, "utf8");
    for (const [label, pattern] of forbiddenSources) {
      if (pattern.test(contents)) {
        console.error(`${label} remains in ${file.slice(root.length + 1)}`);
        process.exit(1);
      }
    }
  }
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      yield path;
    }
  }
}
