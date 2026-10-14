#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const themesDir = path.join(repoRoot, "src", "themes");
const defaultThemePath = path.join(themesDir, "default.css");

const args = process.argv.slice(2);
const options = Object.create(null);
for (const arg of args) {
  if (arg.startsWith("--")) {
    const [key, rawValue] = arg.slice(2).split("=");
    options[key] = rawValue ?? "true";
  }
}

const rawName = options.name || options.n;
if (!rawName) {
  console.error(
    'Usage: pnpm run generate:theme --name=<slug> [--label="Display Name"]',
  );
  process.exit(1);
}

const slug = rawName
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-")
  .replace(/--+/g, "-")
  .replace(/^-+|-+$/g, "");

if (!slug) {
  console.error("Theme name must contain alphanumeric characters.");
  process.exit(1);
}

const label = options.label || toTitleCase(slug);
const outputPath = path.join(themesDir, `${slug}.css`);

if (existsSync(outputPath)) {
  console.error(
    `Theme file already exists at ${path.relative(repoRoot, outputPath)}`,
  );
  process.exit(1);
}

if (!existsSync(defaultThemePath)) {
  console.error("Default theme template missing at src/themes/default.css");
  process.exit(1);
}

const defaultCss = readFileSync(defaultThemePath, "utf8");
const stampedBanner = [
  `/* ${label} Theme (generated ${new Date().toISOString()}) */`,
  "/* Duplicate of default.css — update tokens, colors, and AppKit overrides as needed. */",
].join("\n");
const normalized = defaultCss.replace(
  "/* @aomi-labs/widget - Theme Styles */",
  stampedBanner,
);

mkdirSync(themesDir, { recursive: true });
writeFileSync(outputPath, normalized, "utf8");

console.log(`Created ${path.relative(repoRoot, outputPath)}`);
console.log(
  "Reminder: add metadata to src/themes/tokens.config.ts and wire docs/templates accordingly.",
);

function toTitleCase(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
