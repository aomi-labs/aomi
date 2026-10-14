#!/usr/bin/env node
// @deprecated The `aomi` command moved to @aomi-labs/cli. This shim is
// removed in @aomi-labs/client 1.0.0.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

let manifestPath;
try {
  manifestPath = createRequire(import.meta.url).resolve(
    "@aomi-labs/cli/package.json",
  );
} catch {
  console.error(
    "The aomi command now ships in @aomi-labs/cli. Install it with:\n  npm install -g @aomi-labs/cli",
  );
  process.exit(1);
}
const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
await import(pathToFileURL(join(dirname(manifestPath), bin.aomi)).href);
