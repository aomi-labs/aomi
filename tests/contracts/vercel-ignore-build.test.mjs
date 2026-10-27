import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { deploymentDecision } from "../../scripts/vercel-ignore-build.mjs";

const previewEnv = (branch, pullRequestId = "") => ({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: branch,
  VERCEL_GIT_PULL_REQUEST_ID: pullRequestId,
});

test("preserves standalone previews on agent and temporary branches", () => {
  const portalProject = "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK";
  for (const branch of [
    "codex/cost-audit",
    "codex-queue/repair",
    "claude/project-thread",
    "cursor/feature",
    "agent/feature",
    "agents/feature",
    "tmp/experiment",
    "temp/experiment",
    "wip/feature",
  ]) {
    // No Vercel comparison metadata: keep the preview, regardless of branch.
    assert.equal(deploymentDecision(previewEnv(branch)).ignore, false, branch);
    // With a trustworthy diff, build the affected app on that same branch.
    assert.equal(
      deploymentDecision(
        {
          ...previewEnv(branch),
          VERCEL_GIT_COMMIT_SHA: "head",
          VERCEL_GIT_PREVIOUS_SHA: "base",
          VERCEL_PROJECT_ID: portalProject,
        },
        () => ["apps/portal/src/app/page.tsx"],
      ).ignore,
      false,
      branch,
    );
  }
});

test("keeps PR previews for automated QA", () => {
  assert.equal(
    deploymentDecision(previewEnv("codex/implementation", "1366")).ignore,
    false,
  );
});

test("filters PR builds by affected app while keeping both Portal and Build QA previews", () => {
  const portalDeployment = {
    ...previewEnv("feature/portal-change", "1366"),
    VERCEL_GIT_COMMIT_SHA: "head",
    VERCEL_GIT_PREVIOUS_SHA: "base",
    VERCEL_PROJECT_ID: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
  };
  const landingChange = () => ["apps/landing/content/guide.mdx"];
  const portalChange = () => ["apps/portal/src/app/page.tsx"];

  assert.equal(
    deploymentDecision(portalDeployment, undefined, landingChange).ignore,
    true,
  );
  assert.equal(
    deploymentDecision(portalDeployment, undefined, portalChange).ignore,
    false,
  );

  const buildDeployment = {
    ...portalDeployment,
    VERCEL_PROJECT_ID: "prj_dzx0PWpEPEIbxRjfAzQEiqmNzhRO",
  };
  assert.equal(
    deploymentDecision(buildDeployment, undefined, portalChange).ignore,
    false,
  );

  const landingDeployment = {
    ...portalDeployment,
    VERCEL_PROJECT_ID: "prj_kHH1ejA054BYD3xi831h4BFmxJjO",
  };
  assert.equal(
    deploymentDecision(landingDeployment, undefined, portalChange).ignore,
    true,
  );
  assert.equal(
    deploymentDecision(landingDeployment, undefined, landingChange).ignore,
    false,
  );
});

test("keeps explicitly requested, release, ordinary and production deployments", () => {
  for (const branch of [
    "preview/agent-check",
    "qa/candidate",
    "release/2026-10-16",
    "feature/search",
  ]) {
    assert.equal(deploymentDecision(previewEnv(branch)).ignore, false, branch);
  }

  const unrelatedChange = () => ["apps/landing/content/guide.mdx"];
  for (const branch of [
    "preview/agent-check",
    "qa/candidate",
    "release/2026-10-16",
  ]) {
    assert.equal(
      deploymentDecision(
        {
          ...previewEnv(branch),
          VERCEL_GIT_COMMIT_SHA: "head",
          VERCEL_GIT_PREVIOUS_SHA: "base",
          VERCEL_PROJECT_ID: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
        },
        unrelatedChange,
      ).ignore,
      false,
      `${branch} must build every deployable surface`,
    );
  }

  assert.equal(
    deploymentDecision({
      ...previewEnv("codex/production"),
      VERCEL_ENV: "production",
    }).ignore,
    false,
  );
});

test("fails open when Vercel Git metadata is unavailable", () => {
  assert.equal(deploymentDecision({ VERCEL_ENV: "preview" }).ignore, false);
  assert.equal(
    deploymentDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "codex/implementation",
    }).ignore,
    false,
  );

  assert.equal(
    deploymentDecision({
      ...previewEnv("feature/portal-change"),
      VERCEL_GIT_COMMIT_SHA: "head",
      VERCEL_PROJECT_ID: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
    }).ignore,
    false,
  );
  assert.equal(
    deploymentDecision(
      {
        ...previewEnv("codex/first-pr", "123"),
        VERCEL_GIT_COMMIT_SHA: "head",
        VERCEL_PROJECT_ID: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
      },
      undefined,
      () => null,
    ).ignore,
    false,
    "unresolvable PR must build rather than skip",
  );
});

test("preserves Telegram deployments while skipping builds for removed source", () => {
  const primary = "prj_siJXojKKJ3tnqn7ZtLzvImKQGgnQ";
  const staging = "prj_AWIwZJ8VT0YS20VVN2wQn822mIhS";
  for (const projectId of [primary, staging]) {
    for (const branch of [
      "feature/agent-wallets",
      "main",
      "preview/test",
      "qa/smoke",
      "release/candidate",
    ]) {
      assert.equal(
        deploymentDecision({
          ...previewEnv(branch, "752"),
          VERCEL_GIT_COMMIT_SHA: "head",
          VERCEL_PROJECT_ID: projectId,
        }).ignore,
        true,
        `${projectId} must skip ${branch} after Telegram source removal`,
      );
    }
  }

  assert.equal(
    deploymentDecision({
      ...previewEnv("main"),
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: staging,
    }).ignore,
    true,
    "the Telegram staging project must keep its last deployment",
  );
  assert.equal(
    deploymentDecision({
      ...previewEnv("prod"),
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: primary,
    }).ignore,
    false,
    "the primary Telegram Production deployment remains unchanged",
  );
});

test("uses Vercel ignore-command exit semantics", () => {
  const script = fileURLToPath(
    new URL("../../scripts/vercel-ignore-build.mjs", import.meta.url),
  );
  const skipped = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...previewEnv("codex/telegram-work", "1366"),
      VERCEL_PROJECT_ID: "prj_AWIwZJ8VT0YS20VVN2wQn822mIhS",
    },
  });
  const required = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...previewEnv("codex/implementation") },
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(required.status, 1, required.stderr);
});
