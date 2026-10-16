#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  changedPathsBetween,
  changedPathsForPullRequest,
  selectsVercelProject,
} from "../.github/scripts/select-ci-paths.mjs";

const TELEGRAM_STAGING_PROJECT_ID = "prj_AWIwZJ8VT0YS20VVN2wQn822mIhS";

const ON_DEMAND_BRANCH_PREFIXES = ["preview/", "qa/", "release/"];

const PROJECT_SURFACES = {
  prj_JFlrYJshAAVu7U5BxFhLUUpzjegK: "portal",
  prj_dzx0PWpEPEIbxRjfAzQEiqmNzhRO: "build",
  prj_kHH1ejA054BYD3xi831h4BFmxJjO: "landing",
  prj_siJXojKKJ3tnqn7ZtLzvImKQGgnQ: "telegram",
  prj_AWIwZJ8VT0YS20VVN2wQn822mIhS: "telegram",
};

export function deploymentDecision(
  env,
  getChangedPaths = changedPathsBetween,
  getPullRequestPaths = changedPathsForPullRequest,
) {
  const {
    VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: branch,
    VERCEL_GIT_COMMIT_SHA: headSha,
    VERCEL_GIT_PREVIOUS_SHA: previousSha,
    VERCEL_GIT_PULL_REQUEST_ID: pullRequestId,
    VERCEL_PROJECT_ID: projectId,
  } = env;

  if (VERCEL_ENV !== "preview") {
    return {
      ignore: false,
      reason: "only standalone preview deployments are filtered",
    };
  }

  // Fail open if Vercel has not exposed its Git metadata. This keeps manual,
  // release and future deployment paths buildable when project settings vary.
  if (typeof branch !== "string" || typeof pullRequestId !== "string") {
    return { ignore: false, reason: "Vercel Git metadata is unavailable" };
  }

  const normalizedBranch = branch.toLowerCase();
  if (
    ON_DEMAND_BRANCH_PREFIXES.some((prefix) =>
      normalizedBranch.startsWith(prefix),
    )
  ) {
    return {
      ignore: false,
      reason: "branch explicitly requests a complete preview deployment",
    };
  }

  // Preserve standalone previews even for codex/*, claude/* and other agent
  // branches. Branch names are not evidence that a deployment is disposable.
  // Telegram's separate staging project, however, only serves main-based
  // release qualification; ordinary PRs use the primary Telegram preview.
  if (
    projectId === TELEGRAM_STAGING_PROJECT_ID &&
    pullRequestId !== "" &&
    normalizedBranch !== "main"
  ) {
    return { ignore: true, reason: "Telegram staging does not need ordinary PR previews" };
  }

  if (normalizedBranch === "prod") {
    return {
      ignore: false,
      reason: "production branch deployments are required",
    };
  }

  const surface = PROJECT_SURFACES[projectId];
  if (!surface || !headSha) {
    return {
      ignore: false,
      reason: "project or Git history is unavailable; building safely",
    };
  }

  // A PR must be classified by its entire diff. The previous successful
  // deployment can be empty on first preview, or omit earlier PR commits.
  const paths = pullRequestId
    ? getPullRequestPaths(pullRequestId, headSha)
    : getChangedPaths(previousSha, headSha, { mode: "push" });
  if (paths === null) {
    return {
      ignore: false,
      reason: "changed paths are unavailable; building safely",
    };
  }

  if (selectsVercelProject(paths, surface)) {
    return { ignore: false, reason: `${surface} is affected by this commit` };
  }

  return { ignore: true, reason: `${surface} is unaffected by this commit` };
}

function run() {
  const decision = deploymentDecision(process.env);
  console.log(decision.reason);
  process.exitCode = decision.ignore ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}
