import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaths } from "../../.github/scripts/select-ci-paths.mjs";

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
