#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_KEYS = [
  "packages",
  "apps",
  "portal",
  "build",
  "landing",
  "telegram",
  "journeys",
  "browser_contracts",
  "consumer_compat",
  "workflow_policy",
];

// Jobs that gate npm publishing. On pull requests they run only when the PR
// touches a release-gating path; push to main, the nightly schedule and manual
// dispatch run them whenever they are selected.
const RELEASE_GATED_KEYS = ["consumer_compat", "browser_contracts"];

const APP_KEYS = ["portal", "build", "landing", "telegram"];

function emptySelection(reason = "paths") {
  return Object.fromEntries([
    ...OUTPUT_KEYS.map((key) => [key, false]),
    ["full", false],
    ["release_gate", false],
    ["journeys_core", false],
    ["reason", reason],
  ]);
}

function select(selection, ...keys) {
  for (const key of keys) selection[key] = true;
}

function selectApps(selection, ...apps) {
  select(selection, "apps", ...apps);
}

function selectAll(reason) {
  const selection = emptySelection(reason);
  for (const key of OUTPUT_KEYS) selection[key] = true;
  selection.full = true;
  selection.release_gate = true;
  selection.journeys_core = true;
  return selection;
}

function selectSharedFrontend(selection) {
  select(
    selection,
    "packages",
    "consumer_compat",
    "journeys",
    "browser_contracts",
  );
  selectApps(selection, ...APP_KEYS);
}

function isDocumentationOnly(path) {
  return (
    /^(docs|memory|artifacts|output|demo|\.specstory|\.agents|\.codex)\//.test(
      path,
    ) ||
    /^(README(?:\.[^/]*)?|AGENTS\.md|CLAUDE\.md|GOAL\.md|LICENSE(?:\.[^/]*)?|\.gitignore)$/.test(
      path,
    )
  );
}

function classifyPath(selection, path) {
  if (
    path === ".github/scripts/select-ci-paths.mjs" ||
    path === "tests/contracts/ci-path-selection.test.mjs"
  ) {
    return selectAll("selector_changed");
  }

  if (
    path === ".github/workflows/ci.yml" ||
    path === ".github/workflows/widget-package-contracts.yml"
  ) {
    select(selection, "workflow_policy", "consumer_compat", "release_gate");
    return selection;
  }

  if (
    path === ".github/scripts/check-workflow-policy.py" ||
    path.startsWith(".github/workflows/")
  ) {
    select(selection, "workflow_policy");
    return selection;
  }

  if (path.startsWith(".github/")) {
    select(selection, "workflow_policy");
    return selection;
  }

  if (
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|playwright\.config\.[^/]+|vitest\.config\.[^/]+)$/.test(
      path,
    ) ||
    /^(tsconfig|eslint|prettier|next\.config)[^/]*\./.test(path) ||
    /^(patches|infra)\//.test(path)
  ) {
    return selectAll("global_dependency");
  }

  if (/^(src|components|hooks|lib|themes|utils|public)\//.test(path)) {
    selectSharedFrontend(selection);
    select(selection, "journeys_core");
    return selection;
  }

  if (path.startsWith("apps/portal/")) {
    selectApps(selection, "portal");
    select(selection, "journeys", "journeys_core", "browser_contracts");
    return selection;
  }

  if (path.startsWith("apps/build/")) {
    selectApps(selection, "build");
    return selection;
  }

  if (path.startsWith("apps/landing/")) {
    selectApps(selection, "landing");
    return selection;
  }

  if (path.startsWith("apps/telegram/")) {
    selectApps(selection, "telegram");
    return selection;
  }

  if (path.startsWith("packages/widget/")) {
    selectSharedFrontend(selection);
    select(selection, "journeys_core", "release_gate");
    return selection;
  }

  if (path.startsWith("examples/embed-vite/")) {
    select(
      selection,
      "consumer_compat",
      "journeys",
      "browser_contracts",
      "release_gate",
    );
    return selection;
  }

  if (path.startsWith("examples/embed-next/")) {
    select(selection, "consumer_compat", "browser_contracts", "release_gate");
    return selection;
  }

  if (path.startsWith("examples/")) {
    select(selection, "consumer_compat", "release_gate");
    return selection;
  }

  if (path.startsWith(".changeset/")) {
    select(selection, "consumer_compat", "release_gate");
    return selection;
  }

  if (
    path.startsWith("packages/deploy/") ||
    path.startsWith("packages/smither/")
  ) {
    select(selection, "packages", "consumer_compat", "release_gate");
    selectApps(selection, "build");
    return selection;
  }

  if (path.startsWith("packages/")) {
    selectSharedFrontend(selection);
    select(selection, "release_gate");
    return selection;
  }

  if (
    path === "playwright.journeys.config.ts" ||
    path === "tests/e2e/journey-fixture.ts" ||
    path === "tests/e2e/portal-env.ts" ||
    /^tests\/e2e\/(journeys|performance|pom|fake-backend)\//.test(path)
  ) {
    select(selection, "journeys", "journeys_core", "browser_contracts");
    return selection;
  }

  // Harness changes for the release-gating jobs run those jobs on the PR.
  if (
    /^scripts\/ci\/(test-browser-contracts|test-packed-consumers|browser-hosts)\.mjs$/.test(
      path,
    ) ||
    path.startsWith("scripts/ci/performance/") ||
    path.startsWith("tests/e2e/browser-") ||
    path.startsWith("tests/e2e/fixture")
  ) {
    select(selection, "browser_contracts", "release_gate");
    return selection;
  }

  if (
    path.startsWith("scripts/ci/check-consumer-compatibility") ||
    path === "scripts/ci/consumer-lockfile.mjs" ||
    path.startsWith("tests/contracts/")
  ) {
    select(selection, "consumer_compat", "release_gate");
    return selection;
  }

  if (path.startsWith("scripts/") || path.startsWith("tests/")) {
    return selectAll("unmapped_test_or_script");
  }

  if (isDocumentationOnly(path)) return selection;

  return selectAll("unmapped_path");
}

// Pull requests run a lean set: release-gating jobs only for release paths,
// journeys only for Portal/widget changes and only the smoke subset.
function finalize(selection, { pullRequest, forceFull }) {
  const lean = pullRequest && !forceFull;
  if (lean && !selection.release_gate)
    for (const key of RELEASE_GATED_KEYS) selection[key] = false;
  if (lean && !selection.journeys_core) selection.journeys = false;
  selection.journeys_scope = lean ? "smoke" : "full";
  selection.package_build =
    selection.packages || selection.apps || selection.journeys;
  selection.app_matrix = APP_KEYS.filter((app) => selection[app]);
  if (!selection.full) {
    const selected = OUTPUT_KEYS.filter((key) => selection[key]);
    selection.reason =
      selected.length === 0
        ? "documentation_only"
        : `selected:${selected.join(",")}`;
  }
  return selection;
}

export function classifyPaths(
  paths,
  { forceFull = false, pullRequest = false } = {},
) {
  const options = { pullRequest, forceFull };
  if (forceFull) return finalize(selectAll("production_or_forced"), options);
  if (paths.length === 0)
    return finalize(selectAll("empty_comparison"), options);

  let selection = emptySelection();
  for (const path of paths) {
    selection = classifyPath(selection, path);
    if (selection.full) break;
  }
  return finalize(selection, options);
}

function changedPaths() {
  const base = process.env.CI_BASE_SHA;
  const head = process.env.CI_HEAD_SHA;
  if (!base || !head || /^0+$/.test(base)) return null;

  const separator = process.env.CI_DIFF_MODE === "push" ? ".." : "...";
  try {
    const output = execFileSync(
      "git",
      [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        `${base}${separator}${head}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function writeOutputs(selection, paths) {
  const lines = [];
  for (const key of [...OUTPUT_KEYS, "full", "package_build"])
    lines.push(`${key}=${selection[key] ? "true" : "false"}`);
  lines.push(`app_matrix=${JSON.stringify(selection.app_matrix)}`);
  lines.push(`journeys_scope=${selection.journeys_scope}`);
  lines.push(`reason=${selection.reason}`);
  lines.push(`changed_count=${paths?.length ?? 0}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const selected = OUTPUT_KEYS.filter((key) => selection[key]);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## CI path selection",
        `- Changed paths: ${paths?.length ?? "comparison unavailable"}`,
        `- Reason: \`${selection.reason}\``,
        `- Journeys scope: \`${selection.journeys_scope}\``,
        `- Selected: ${selected.length ? selected.map((key) => `\`${key}\``).join(", ") : "none"}`,
        "",
      ].join("\n"),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const forceFull = process.env.CI_FORCE_FULL === "1";
  const pullRequest = process.env.CI_DIFF_MODE === "pull_request";
  const paths = changedPaths();
  const selection =
    paths === null
      ? finalize(selectAll("comparison_unavailable"), {
          pullRequest,
          forceFull,
        })
      : classifyPaths(paths, { forceFull, pullRequest });

  if (process.env.GITHUB_OUTPUT) writeOutputs(selection, paths);
  else console.log(JSON.stringify({ paths, selection }, null, 2));
}
