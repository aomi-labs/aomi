import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("accepts an unpublished paired Smither unit move while requiring notes for runtime and configuration changes", () => {
  const script = resolve("scripts/check-package-changesets.mjs");
  const directory = mkdtempSync(join(tmpdir(), "aomi-release-coverage-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(join(directory, "packages/smither/src/__tests__"), {
      recursive: true,
    });
    mkdirSync(join(directory, ".changeset"));
    writeFileSync(
      join(directory, "packages/smither/package.json"),
      JSON.stringify({
        name: "@aomi-labs/smither",
        version: "0.1.0",
        files: ["dist", "README.md"],
      }),
    );
    writeFileSync(
      join(directory, "packages/smither/src/index.ts"),
      "export const runtime = 1;\n",
    );
    const original =
      'import { runtime } from "../index";\n' +
      "// This unit is not a package build entry.\n".repeat(20);
    writeFileSync(
      join(directory, "packages/smither/src/__tests__/runtime.test.ts"),
      original,
    );
    git("init", "-q");
    git("config", "user.email", "coverage@example.test");
    git("config", "user.name", "Release coverage fixture");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    git("commit", "-qm", "Published runtime");
    const base = git("rev-parse", "HEAD");
    const check = () =>
      spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, CI_BASE_SHA: base },
      });
    git(
      "mv",
      "packages/smither/src/__tests__/runtime.test.ts",
      "packages/smither/src/runtime.test.ts",
    );
    writeFileSync(
      join(directory, "packages/smither/src/runtime.test.ts"),
      original.replace("../index", "./index"),
    );
    git("add", ".");
    git("commit", "-qm", "Colocate unpublished unit");
    const unitMove = git("rev-parse", "HEAD");
    expect(check().status).toBe(0);
    writeFileSync(
      join(directory, "packages/smither/src/index.ts"),
      "export const runtime = 2;\n",
    );
    git("add", ".");
    git("commit", "-qm", "Change runtime");
    expect(check().stderr).toContain(
      "needs a changeset or a versioned changelog",
    );
    git("reset", "--hard", unitMove);
    const manifestPath = join(directory, "packages/smither/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.push("src");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    git("add", ".");
    git("commit", "-qm", "Change published configuration");
    expect(check().stderr).toContain(
      "needs a changeset or a versioned changelog",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
