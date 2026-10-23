import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyPaths,
  changedPathsBetween,
  changedPathsForPullRequest,
  selectsVercelProject,
} from "../../.github/scripts/select-ci-paths.mjs";

test("plain documentation changes skip product checks", () => {
  const selected = classifyPaths([
    "docs/testing/hosted-wallet-e2e.md",
    "GOAL.md",
  ]);
  assert.equal(selected.reason, "documentation_only");
  assert.equal(selected.apps, false);
  assert.equal(selected.packages, false);
  assert.equal(selected.workflow_policy, false);
});

test("landing content changes select only the landing app", () => {
  const selected = classifyPaths([
    "apps/landing/content/docs/getting-started.mdx",
  ]);
  assert.equal(selected.apps, true);
  assert.equal(selected.landing, true);
  assert.equal(selected.portal, false);
  assert.equal(selected.packages, false);
});

test("Vercel builds only affected apps while preserving Portal and Build QA previews", () => {
  const portalChange = ["apps/portal/src/app/page.tsx"];
  assert.equal(selectsVercelProject(portalChange, "portal"), true);
  assert.equal(selectsVercelProject(portalChange, "build"), true);
  assert.equal(selectsVercelProject(portalChange, "landing"), false);
  assert.equal(selectsVercelProject(portalChange, "telegram"), false);

  const landingChange = ["apps/landing/content/docs/getting-started.mdx"];
  assert.equal(selectsVercelProject(landingChange, "landing"), true);
  assert.equal(selectsVercelProject(landingChange, "portal"), false);
  assert.equal(selectsVercelProject(landingChange, "build"), false);
  assert.equal(selectsVercelProject(landingChange, "telegram"), false);

  const telegramChange = ["apps/telegram/src/app/page.tsx"];
  assert.equal(selectsVercelProject(telegramChange, "telegram"), true);
  assert.equal(selectsVercelProject(telegramChange, "landing"), false);
});

test("Vercel path selection fails broad for shared, global, empty and forced comparisons", () => {
  for (const paths of [
    ["packages/widget/src/runtime.ts"],
    ["pnpm-lock.yaml"],
    [],
  ]) {
    for (const project of ["portal", "build", "landing", "telegram"]) {
      assert.equal(
        selectsVercelProject(paths, project),
        true,
        `${paths}: ${project}`,
      );
    }
  }

  assert.equal(
    selectsVercelProject(["docs/guide.md"], "telegram", { forceFull: true }),
    true,
  );
});

test("changed-file detection compares deployment SHAs and fails open for missing history", () => {
  const repo = mkdtempSync(join(tmpdir(), "aomi-ci-paths-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

  try {
    git("init", "-q");
    git("config", "user.name", "CI path test");
    git("config", "user.email", "ci-path-test@example.invalid");
    writeFileSync(join(repo, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");

    mkdirSync(join(repo, "apps/landing/content"), { recursive: true });
    writeFileSync(join(repo, "apps/landing/content/guide.mdx"), "changed\n");
    git("add", ".");
    git("commit", "-qm", "landing content");
    const head = git("rev-parse", "HEAD");

    assert.deepEqual(
      changedPathsBetween(base, head, { mode: "push", cwd: repo }),
      ["apps/landing/content/guide.mdx"],
    );
    assert.equal(changedPathsBetween(base, "missing-sha", { cwd: repo }), null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("portal changes select portal and its browser surfaces", () => {
  const selected = classifyPaths(["apps/portal/src/app/page.tsx"]);
  assert.equal(selected.portal, true);
  assert.equal(selected.journeys, true);
  assert.equal(selected.browser_contracts, true);
  assert.equal(selected.preview, true);
  assert.equal(selected.consumer_compat, false);
});

test("renames and deletions select from both reported paths", () => {
  const selected = classifyPaths([
    "docs/retired-page.md",
    "apps/portal/src/app/replacement/page.tsx",
  ]);
  assert.equal(selected.portal, true);
  assert.equal(selected.journeys, true);
  assert.equal(selected.preview, true);
});

test("shared package changes fan out to every dependent surface", () => {
  const selected = classifyPaths(["packages/react/src/runtime.ts"]);
  assert.equal(selected.packages, true);
  assert.equal(selected.consumer_compat, true);
  assert.equal(selected.journeys, true);
  assert.equal(selected.browser_contracts, true);
  for (const app of ["portal", "build", "landing", "telegram"]) {
    assert.equal(selected[app], true);
  }
});

test("workflow changes run policy without unrelated product jobs", () => {
  const selected = classifyPaths([".github/workflows/hosted-wallet-e2e.yml"]);
  assert.equal(selected.workflow_policy, true);
  assert.equal(selected.packages, false);
  assert.equal(selected.apps, false);
});

test("selector, lockfile, unknown, and production changes fail broad", () => {
  for (const paths of [
    [".github/scripts/select-ci-paths.mjs"],
    ["pnpm-lock.yaml"],
    ["some-new-root/surprise.txt"],
  ]) {
    const selected = classifyPaths(paths);
    assert.equal(selected.full, true);
    assert.equal(selected.packages, true);
    assert.equal(selected.workflow_policy, true);
  }

  assert.equal(
    classifyPaths(["docs/readme.md"], { forceFull: true }).full,
    true,
  );
});

test("required widget guard workflow changes exercise their actual consumer gates", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/widget-package-contracts.yml",
  ]) {
    const selected = classifyPaths([path]);
    assert.equal(selected.workflow_policy, true);
    assert.equal(selected.consumer_compat, true);
  }
});

test("retired Base paths fail broad across active apps without a retired output", () => {
  const selected = classifyPaths(["apps/base/app/page.tsx"]);
  assert.equal(selected.full, true);
  assert.equal(selected.reason, "unmapped_path");
  assert.equal(Object.hasOwn(selected, "base"), false);
  for (const app of ["portal", "build", "landing", "telegram"]) {
    assert.equal(selected[app], true);
  }
});

test("both embed examples retain packed install and browser gates", () => {
  for (const folder of ["embed-vite", "embed-next"]) {
    const selected = classifyPaths([`examples/${folder}/package.json`]);
    assert.equal(selected.consumer_compat, true);
    assert.equal(selected.browser_contracts, true);
  }
});

test("journey harness changes run the journeys and the packed browser jobs only", () => {
  for (const path of [
    "tests/e2e/journeys/cold-load.spec.ts",
    "tests/e2e/fake-backend/backend.ts",
    "playwright.journeys.config.ts",
  ]) {
    const selected = classifyPaths([path]);
    assert.equal(selected.journeys, true, path);
    assert.equal(selected.browser_contracts, true, path);
    assert.equal(selected.packages, false, path);
  }
});

test("PR comparison includes all commits via exact-head GitHub merge ref", () => {
  const repo = mkdtempSync(join(tmpdir(), "aomi-pr-diff-"));
  const checkout = mkdtempSync(join(tmpdir(), "aomi-pr-shallow-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "PR test");
    git("config", "user.email", "pr-test@example.invalid");
    git("checkout", "-qb", "main");
    writeFileSync(join(repo, "README.md"), "baseline\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "codex/multi-commit");
    mkdirSync(join(repo, "apps/landing"), { recursive: true });
    writeFileSync(join(repo, "apps/landing/page.tsx"), "landing\n");
    git("add", ".");
    git("commit", "-qm", "landing");
    mkdirSync(join(repo, "apps/telegram"), { recursive: true });
    writeFileSync(join(repo, "apps/telegram/page.tsx"), "telegram\n");
    git("add", ".");
    git("commit", "-qm", "telegram");
    const prHead = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "codex/multi-commit", "-m", "merge");
    git("update-ref", "refs/pull/123/merge", "HEAD");
    git("checkout", "-q", "codex/multi-commit");
    git("clone", "-q", "--depth=1", "--no-local", repo, checkout);

    assert.deepEqual(
      changedPathsForPullRequest("123", prHead, { cwd: checkout }).sort(),
      ["apps/landing/page.tsx", "apps/telegram/page.tsx"],
    );
    assert.equal(
      changedPathsForPullRequest("123", "a".repeat(40), { cwd: checkout }),
      null,
      "stale merge head must fail open",
    );
    assert.equal(
      changedPathsForPullRequest("not-a-number", prHead, { cwd: checkout }),
      null,
    );
    assert.equal(
      changedPathsForPullRequest("99999", prHead, { cwd: checkout }),
      null,
    );
  } finally {
    rmSync(checkout, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("PR deployment selection agrees with CI when base independently acquires a PR change", () => {
  const repo = mkdtempSync(join(tmpdir(), "aomi-pr-overlap-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "PR test");
    git("config", "user.email", "pr-test@example.invalid");
    git("checkout", "-qb", "main");
    writeFileSync(join(repo, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "codex/portal-change");
    mkdirSync(join(repo, "apps/portal"), { recursive: true });
    writeFileSync(join(repo, "apps/portal/page.tsx"), "portal\n");
    git("add", ".");
    git("commit", "-qm", "portal");
    const portalCommit = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "README.md"), "PR docs\n");
    git("commit", "-qam", "docs");
    const head = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs/main.md"), "main advanced independently\n");
    git("add", ".");
    git("commit", "-qm", "advance main");
    git("cherry-pick", "--quiet", portalCommit);
    const base = git("rev-parse", "HEAD");
    const ciPaths = changedPathsBetween(base, head, { cwd: repo });
    git("merge", "--no-ff", "-q", "codex/portal-change", "-m", "merge");
    git("update-ref", "refs/pull/456/merge", "HEAD");
    git("remote", "add", "origin", ".");
    git("checkout", "-q", "codex/portal-change");

    const deploymentPaths = changedPathsForPullRequest("456", head, {
      cwd: repo,
    });
    assert.deepEqual(deploymentPaths, ciPaths);
    for (const project of ["portal", "build"]) {
      assert.equal(selectsVercelProject(deploymentPaths, project), true);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
