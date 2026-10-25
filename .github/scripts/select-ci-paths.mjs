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
  "preview",
];

const APP_KEYS = ["portal", "build", "landing", "telegram"];

function emptySelection(reason = "paths") {
  return Object.fromEntries([
    ...OUTPUT_KEYS.map((key) => [key, false]),
    ["full", false],
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
  return selection;
}

function selectSharedFrontend(selection) {
  select(
    selection,
    "packages",
    "consumer_compat",
    "journeys",
    "browser_contracts",
    "preview",
  );
  selectApps(selection, ...APP_KEYS);
}

function isDocumentationOnly(path) {
  return (
    /^(docs|memory|specs|artifacts|output|demo|\.specstory|\.agents|\.codex)\//.test(
      path,
    ) ||
    /^(README(?:\.[^/]*)?|GOAL\.md|LICENSE(?:\.[^/]*)?|\.gitignore)$/.test(path)
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
    select(selection, "workflow_policy", "consumer_compat");
    return selection;
  }

  if (
    path === ".github/scripts/check-workflow-policy.py" ||
    path.startsWith(".github/workflows/")
  ) {
    select(selection, "workflow_policy");
    return selection;
  }

  if (path === ".github/scripts/resolve-preview-urls.sh") {
    select(selection, "workflow_policy", "preview");
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
    return selection;
  }

  if (path.startsWith("apps/portal/")) {
    selectApps(selection, "portal");
    select(selection, "journeys", "browser_contracts", "preview");
    return selection;
  }

  if (path.startsWith("apps/build/")) {
    selectApps(selection, "build");
    select(selection, "preview");
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

  // The edge Worker has no Vercel project; its unit tests run with the
  // workspace suite and its deploy is driven from product-mono.
  if (path.startsWith("apps/edge/")) {
    select(selection, "packages");
    return selection;
  }

  if (path.startsWith("packages/widget/")) {
    selectSharedFrontend(selection);
    return selection;
  }

  if (path.startsWith("examples/embed-vite/")) {
    select(selection, "consumer_compat", "journeys", "browser_contracts");
    return selection;
  }

  if (path.startsWith("examples/embed-next/")) {
    select(selection, "consumer_compat", "browser_contracts");
    return selection;
  }

  if (path.startsWith("examples/")) {
    select(selection, "consumer_compat");
    return selection;
  }

  if (
    path.startsWith("packages/deploy/") ||
    path.startsWith("packages/internal/") ||
    path.startsWith("packages/smither/")
  ) {
    select(selection, "packages", "consumer_compat");
    selectApps(selection, "build");
    select(selection, "preview");
    return selection;
  }

  if (path.startsWith("packages/")) {
    selectSharedFrontend(selection);
    return selection;
  }

  if (
    path === "playwright.journeys.config.ts" ||
    path === "tests/e2e/journey-fixture.ts" ||
    path === "tests/e2e/portal-env.ts" ||
    /^tests\/e2e\/(journeys|performance|pom|fake-backend)\//.test(path)
  ) {
    select(selection, "journeys", "browser_contracts");
    return selection;
  }

  if (
    /^scripts\/(test-browser-contracts|test-packed-consumers|browser-hosts)\.mjs$/.test(
      path,
    ) ||
    path.startsWith("scripts/performance/") ||
    path.startsWith("tests/e2e/browser-") ||
    path.startsWith("tests/e2e/fixture")
  ) {
    select(selection, "browser_contracts");
    return selection;
  }

  if (
    path.startsWith("scripts/check-consumer-compatibility") ||
    path === "scripts/consumer-lockfile.mjs" ||
    path.startsWith("tests/contracts/")
  ) {
    select(selection, "consumer_compat");
    return selection;
  }

  if (path.startsWith("scripts/") || path.startsWith("tests/")) {
    return selectAll("unmapped_test_or_script");
  }

  if (isDocumentationOnly(path)) return selection;

  return selectAll("unmapped_path");
}

export function classifyPaths(paths, { forceFull = false } = {}) {
  if (forceFull) return selectAll("production_or_forced");
  if (paths.length === 0) return selectAll("empty_comparison");

  let selection = emptySelection();
  for (const path of paths) {
    selection = classifyPath(selection, path);
    if (selection.full) return selection;
  }

  const selected = OUTPUT_KEYS.filter((key) => selection[key]);
  selection.reason =
    selected.length === 0
      ? "documentation_only"
      : `selected:${selected.join(",")}`;
  return selection;
}

export function selectsVercelProject(
  paths,
  project,
  { forceFull = false } = {},
) {
  if (!APP_KEYS.includes(project)) return true;

  const selection = classifyPaths(paths, { forceFull });
  if (selection.full || selection[project]) return true;

  // Preview E2E resolves immutable deployments for both apps on every path
  // selection that enables it. Keep those exact-SHA Portal/Build previews.
  return selection.preview && (project === "portal" || project === "build");
}

export function changedPathsBetween(
  base,
  head,
  { mode = "pull_request", cwd = process.cwd() } = {},
) {
  if (!base || !head || /^0+$/.test(base)) return null;

  const separator = mode === "push" ? ".." : "...";
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
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

// Match CI's complete three-dot PR diff, including on a branch's first build.
// The merge ref identifies the base and verifies the deployed PR head, but its
// tree diff can omit changes already landed independently on the base. Fetch
// bounded history for the merge-base; missing history or refs fail open.
export function changedPathsForPullRequest(
  pullRequestId,
  head,
  { cwd = process.cwd() } = {},
) {
  if (!/^[1-9]\d*$/.test(pullRequestId) || !/^[a-f0-9]{40}$/i.test(head)) {
    return null;
  }
  try {
    execFileSync(
      "git",
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=100",
        "origin",
        `refs/pull/${pullRequestId}/merge`,
      ],
      { cwd, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const [merge, base, prHead] = execFileSync(
      "git",
      ["rev-list", "--parents", "-n", "1", "FETCH_HEAD"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .trim()
      .split(/\s+/);
    // A stale GitHub merge ref cannot qualify a newer PR head.
    if (!merge || !base || prHead !== head) return null;
    return changedPathsBetween(base, prHead, { cwd });
  } catch {
    return null;
  }
}

function changedPaths() {
  return changedPathsBetween(process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA, {
    mode: process.env.CI_DIFF_MODE,
  });
}

function writeOutputs(selection, paths) {
  const lines = [];
  for (const key of [...OUTPUT_KEYS, "full"])
    lines.push(`${key}=${selection[key] ? "true" : "false"}`);
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
  const paths = changedPaths();
  const selection =
    paths === null
      ? selectAll("comparison_unavailable")
      : classifyPaths(paths, { forceFull });

  if (process.env.GITHUB_OUTPUT) writeOutputs(selection, paths);
  else console.log(JSON.stringify({ paths, selection }, null, 2));
}
