#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const tag = process.env.GITHUB_REF_NAME;
if (!/^packages-v/.test(tag ?? ""))
  throw new Error(
    "Package publication requires the tested packages-v* tag workflow",
  );
const repository = process.env.GITHUB_REPOSITORY;
const ciRun = execFileSync(
  "gh",
  [
    "api",
    `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${process.env.GITHUB_SHA}&status=success&per_page=100`,
    "--jq",
    ".workflow_runs[0].id // empty",
  ],
  { encoding: "utf8" },
).trim();
if (!ciRun) throw new Error("Publication requires successful same-SHA main CI");
const contractsJob = execFileSync(
  "gh",
  [
    "api",
    "--paginate",
    `repos/${repository}/actions/runs/${ciRun}/jobs?filter=latest&per_page=100`,
    "--jq",
    '.jobs[] | select(.name == "Widget package contracts · API, fresh installs, docs / contracts" and .conclusion == "success") | .id',
  ],
  { encoding: "utf8" },
).trim();
if (!contractsJob)
  throw new Error(
    "Publication requires successful same-SHA widget package contracts",
  );
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const tagged = execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
  encoding: "utf8",
}).trim();
if (head !== tagged || head !== process.env.GITHUB_SHA)
  throw new Error("Checkout must equal the immutable tag SHA");
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
  }).trim()
)
  throw new Error("Refuse to publish a modified tracked checkout");
for (const directory of [
  "packages/client",
  "packages/react",
  "packages/service-identity",
  "packages/account",
  "packages/deploy",
  "packages/cli",
  "packages/widget",
]) {
  const path = resolve(directory, "package.json");
  if (!existsSync(path))
    throw new Error(`Missing publishable manifest: ${directory}`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.private) continue;
  execFileSync(
    process.execPath,
    ["scripts/publish-package-if-needed.mjs", directory],
    { stdio: "inherit" },
  );
}
execFileSync(process.execPath, ["scripts/check-published-cli.mjs"], {
  stdio: "inherit",
});
