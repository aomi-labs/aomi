#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run after publication: a working migration shim cannot prove that its
// replacement exists on the public registry or installs outside this repo.
export function checkPublishedCli({
  root = process.cwd(),
  run = execFileSync,
} = {}) {
  const { name, version } = JSON.parse(
    readFileSync(join(root, "packages/cli/package.json"), "utf8"),
  );
  const directory = mkdtempSync(join(tmpdir(), "aomi-published-cli-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ private: true }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
        `--cache=${join(directory, "cache")}`,
        `${name}@${version}`,
      ],
      {
        cwd: directory,
        stdio: "pipe",
        timeout: 180_000,
      },
    );
    const binary = join(directory, "node_modules/.bin/aomi");
    const options = { cwd: directory, encoding: "utf8", timeout: 30_000 };
    const installed = run(binary, ["--version"], options).trim();
    if (installed !== version)
      throw new Error(
        `Installed CLI reported ${installed}; expected ${version}`,
      );
    const help = run(binary, ["tx", "--help"], options);
    if (
      !["export", "submit", "preflight", "status"].every((command) =>
        help.includes(command),
      )
    )
      throw new Error("Installed CLI is missing Commit/payment commands");
    console.log(
      `Public clean install passed: ${name}@${version} (--version, tx --help)`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  checkPublishedCli();
}
