#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_KEYS = [
  "packages",
  "apps",
  "portal",
  "build",
  "base",
  "landing",
  "telegram",
  "guest_browser",
  "browser_contracts",
  "consumer_compat",
  "workflow_policy",
  "preview",
];

const APP_KEYS = ["portal", "build", "base", "landing", "telegram"];

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
    "guest_browser",
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
    select(selection, "guest_browser", "browser_contracts", "preview");
    return selection;
  }

  if (path.startsWith("apps/build/")) {
    selectApps(selection, "build");
    select(selection, "preview");
    return selection;
  }

  if (path.startsWith("apps/base/")) {
    selectApps(selection, "base");
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

  if (path.startsWith("apps/shadcn-registry/")) {
    selectSharedFrontend(selection);
    return selection;
  }

  if (path.startsWith("apps/widget-consumer/")) {
    select(selection, "consumer_compat", "browser_contracts");
    return selection;
  }

  if (path.startsWith("apps/examples/")) {
    select(selection, "consumer_compat");
    return selection;
  }

  if (
    path.startsWith("packages/deploy/") ||
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
    path === "scripts/test-portal-guest-browser.mjs" ||
    path.startsWith("tests/e2e/guest-")
  ) {
    select(selection, "guest_browser");
    return selection;
  }

  if (
    path === "scripts/test-browser-contracts.mjs" ||
    path.startsWith("tests/e2e/browser-") ||
    path.startsWith("tests/e2e/fixtures/")
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
