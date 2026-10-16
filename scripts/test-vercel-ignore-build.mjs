import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { deploymentDecision } from "./vercel-ignore-build.mjs";

const previewEnv = (branch, pullRequestId = "") => ({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: branch,
  VERCEL_GIT_PULL_REQUEST_ID: pullRequestId,
});

test("skips standalone temporary development branch previews", () => {
  for (const branch of [
    "codex/cost-audit",
    "codex-queue/repair-build",
    "claude/project-thread",
    "cursor/feature",
    "agent/feature",
    "agents/feature",
    "work/agent-usefulness",
    "tmp/experiment",
    "temp/experiment",
    "wip/feature",
  ]) {
    assert.equal(deploymentDecision(previewEnv(branch)).ignore, true, branch);
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
    deploymentDecision(portalDeployment, landingChange).ignore,
    true,
  );
  assert.equal(
    deploymentDecision(portalDeployment, portalChange).ignore,
    false,
  );

  const buildDeployment = {
    ...portalDeployment,
    VERCEL_PROJECT_ID: "prj_dzx0PWpEPEIbxRjfAzQEiqmNzhRO",
  };
  assert.equal(deploymentDecision(buildDeployment, portalChange).ignore, false);

  const landingDeployment = {
    ...portalDeployment,
    VERCEL_PROJECT_ID: "prj_kHH1ejA054BYD3xi831h4BFmxJjO",
  };
  assert.equal(
    deploymentDecision(landingDeployment, portalChange).ignore,
    true,
  );
  assert.equal(
    deploymentDecision(landingDeployment, landingChange).ignore,
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
  assert.equal(
    deploymentDecision(
      {
        ...previewEnv("release/2026-10-16"),
        VERCEL_GIT_COMMIT_SHA: "head",
        VERCEL_GIT_PREVIOUS_SHA: "base",
        VERCEL_PROJECT_ID: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
      },
      unrelatedChange,
    ).ignore,
    false,
    "release previews must build every deployable surface",
  );

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
});

test("uses Vercel ignore-command exit semantics", () => {
  const script = fileURLToPath(
    new URL("./vercel-ignore-build.mjs", import.meta.url),
  );
  const skipped = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...previewEnv("codex/implementation") },
  });
  const required = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...previewEnv("codex/implementation", "1366") },
  });

  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(required.status, 1, required.stderr);
});
