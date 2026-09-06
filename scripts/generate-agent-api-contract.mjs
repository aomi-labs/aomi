import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rustRepo = resolve(
  process.env.AOMI_RUST_REPO ?? join(root, "../product-mono/aomi"),
);
const source = join(root, "apps/portal/openapi/aomi-agent-v1.json");
const generated = join(root, "packages/client/src/generated/agent-v1/types.ts");
const artifact = process.env.AOMI_AGENT_OPENAPI_FILE;
const serialized = artifact
  ? readFileSync(resolve(artifact), "utf8")
  : printRustOpenApi();
const document = `${JSON.stringify(JSON.parse(serialized), null, 2)}\n`;
writeFileSync(source, document);

const formatSource = spawnSync(
  join(root, "node_modules/.bin/prettier"),
  ["--write", source],
  { cwd: root, encoding: "utf8" },
);
if (formatSource.status !== 0) {
  process.stderr.write(formatSource.stdout);
  process.stderr.write(formatSource.stderr);
  process.exit(formatSource.status ?? 1);
}

const result = spawnSync(
  "npx",
  ["--yes", "openapi-typescript@7.13.0", source, "-o", generated],
  { cwd: root, encoding: "utf8" },
);
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const sourceHash = createHash("sha256")
  .update(readFileSync(source, "utf8"))
  .digest("hex");
const types = readFileSync(generated, "utf8");
writeFileSync(
  generated,
  `// Rust Agent contract SHA256: ${sourceHash}\n${types}`,
);

const format = spawnSync(
  join(root, "node_modules/.bin/prettier"),
  ["--write", generated],
  { cwd: root, encoding: "utf8" },
);
if (format.status !== 0) {
  process.stderr.write(format.stdout);
  process.stderr.write(format.stderr);
  process.exit(format.status ?? 1);
}

function printRustOpenApi() {
  const rust = spawnSync(
    "cargo",
    ["run", "--quiet", "-p", "api-server", "--", "--print-openapi"],
    { cwd: rustRepo, encoding: "utf8" },
  );
  if (rust.status !== 0) {
    if (rust.stdout) process.stderr.write(rust.stdout);
    if (rust.stderr) process.stderr.write(rust.stderr);
    process.exit(rust.status ?? 1);
  }
  return rust.stdout;
}
