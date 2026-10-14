import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const publicPackages = [
  "client",
  "react",
  "account",
  "deploy",
  "cli",
  "widget",
  "widget-lib",
];
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
let directory;
let candidate;
let environment;
const git = (...args) =>
  execFileSync(realGit, args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const verify = (env = {}) =>
  spawnSync("bash", [resolve(root, ".github/scripts/verify-main-ci.sh")], {
    cwd: directory,
    encoding: "utf8",
    env: { ...environment, ...env },
  });
const publish = (env = {}) =>
  spawnSync(
    process.execPath,
    [resolve(root, "scripts/publish-tagged-packages.mjs")],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...environment,
        GITHUB_SHA: candidate,
        GITHUB_REF_NAME: "packages-v3.1.0",
        ...env,
      },
    },
  );
function commitFile(path, content) {
  mkdirSync(resolve(directory, path, ".."), { recursive: true });
  writeFileSync(join(directory, path), content);
  git("add", path);
  git("commit", "-qm", `Change ${path}`);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "aomi-publish-policy-"));
  git("init", "-q");
  git("config", "user.email", "policy@example.test");
  git("config", "user.name", "Publication policy fixture");
  for (const name of publicPackages) {
    mkdirSync(join(directory, "packages", name), { recursive: true });
    writeFileSync(
      join(directory, "packages", name, "package.json"),
      JSON.stringify({ name: `@aomi-labs/${name}`, version: "1.0.0" }),
    );
  }
  git("add", ".");
  git("commit", "-qm", "Frozen candidate");
  candidate = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", candidate);
  git("tag", "packages-v3.1.0", candidate);
  const bin = join(directory, "test-bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    '#!/bin/sh\nif [ "$1" = fetch ]; then exit 0; fi\nexec "$REAL_GIT" "$@"\n',
  );
  writeFileSync(
    join(bin, "gh"),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$GH_CALL_LOG"\nprintf "%s\\n" "${GH_MOCK_RUN_ID-123}"\n',
  );
  for (const name of ["git", "gh"]) chmodSync(join(bin, name), 0o755);
  mkdirSync(join(directory, "scripts"));
  writeFileSync(
    join(directory, "scripts/publish-package-if-needed.mjs"),
    'import{appendFileSync}from"node:fs";appendFileSync(process.env.PUBLISH_LOG,process.argv[2]+"\\n");',
  );
  environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    GH_TOKEN: "fixture",
    GITHUB_REPOSITORY: "fixture/repository",
    CANDIDATE_SHA: candidate,
    GH_CALL_LOG: join(directory, "gh.log"),
    PUBLISH_LOG: join(directory, "published.log"),
  };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("immutable package publication policy", () => {
  it("rejects superseding changes in every public package and the historical widget path", () => {
    for (const path of [
      ...publicPackages.map((name) => `packages/${name}`),
      "apps/shadcn-registry",
    ]) {
      git("reset", "--hard", candidate);
      commitFile(`${path}/src/changed.ts`, "export const changed = true;\n");
      const result = verify();
      expect(result.status, path).toBe(1);
      expect(result.stderr).toContain("Refusing to publish");
      expect(
        verify({ ALLOW_PUBLISHABLE_PACKAGE_DRIFT: "true" }).status,
        path,
      ).toBe(0);
    }
  });

  it("accepts unrelated main changes while requiring successful CI for the exact candidate", () => {
    commitFile("docs/notes.md", "Unrelated documentation\n");
    expect(verify().status).toBe(0);
    expect(readFileSync(environment.GH_CALL_LOG, "utf8")).toContain(
      `head_sha=${candidate}`,
    );
    const missing = verify({ GH_MOCK_RUN_ID: "" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No successful CI run");
  });

  it("rejects a candidate outside reviewed main ancestry", () => {
    commitFile("docs/branch.md", "Unmerged candidate\n");
    const unmerged = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", candidate);
    const result = verify({ CANDIDATE_SHA: unmerged });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only accepts a SHA merged into main");
  });

  it("publishes exactly the eight public package manifests from the tested tag", () => {
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(environment.PUBLISH_LOG, "utf8").trim().split("\n"),
    ).toEqual(publicPackages.map((name) => `packages/${name}`));
    expect(readFileSync(environment.GH_CALL_LOG, "utf8")).toContain(
      `widget-package-contracts.yml/runs?branch=main&head_sha=${candidate}`,
    );
  });

  it("rejects missing tag contracts, mismatched checkout SHA and modified tracked content", () => {
    expect(publish({ GH_MOCK_RUN_ID: "" }).stderr).toContain(
      "same-SHA widget package contracts",
    );
    expect(publish({ GITHUB_SHA: "0".repeat(40) }).stderr).toContain(
      "immutable tag SHA",
    );
    writeFileSync(join(directory, "packages/client/package.json"), "{}\n");
    expect(publish().stderr).toContain("modified tracked checkout");
  });
});
