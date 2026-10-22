#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run after publication: the client's migration shim can pass CI while the
// package it points at is missing from the public registry.
export function checkPublishedCli({
  root = process.cwd(),
  run = execFileSync,
  attempts = 3,
  sleep = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
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
    // The registry can lag a publish by a minute; retry before failing release.
    for (let attempt = 1; ; attempt += 1) {
      try {
        run(
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--prefer-online",
            "--registry=https://registry.npmjs.org",
            `--cache=${join(directory, "cache")}`,
            `${name}@${version}`,
          ],
          { cwd: directory, stdio: "pipe", timeout: 180_000 },
        );
        break;
      } catch (error) {
        if (attempt >= attempts) throw error;
        sleep(30_000);
      }
    }
    const binary = join(directory, "node_modules/.bin/aomi");
    const options = { cwd: directory, encoding: "utf8", timeout: 30_000 };
    const installed = run(binary, ["--version"], options).trim();
    if (installed !== version)
      throw new Error(
        `Installed CLI reported ${installed}; expected ${version}`,
      );
    // Loading a command group proves the published dependency set resolves.
    run(binary, ["tx", "--help"], options);
    console.log(`Public clean install passed: ${name}@${version}`);
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
