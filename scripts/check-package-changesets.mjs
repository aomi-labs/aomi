#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const base =
  process.env.CI_BASE_SHA ||
  execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
    encoding: "utf8",
  }).trim();
const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
const removed = new Set(
  execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=D", base, "HEAD"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n"),
);
const relocatedSmitherUnits = new Set();
for (const line of execFileSync(
  "git",
  ["diff", "--name-status", "--find-renames", base, "HEAD"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")) {
  const [status, previous, current] = line.split("\t");
  const unit = previous?.match(
    /^packages\/smither\/src\/__tests__\/([^/]+\.test\.ts)$/,
  )?.[1];
  if (
    /^R\d+$/.test(status) &&
    unit &&
    current === `packages/smither/src/${unit}`
  ) {
    relocatedSmitherUnits.add(previous);
    relocatedSmitherUnits.add(current);
  }
}
function isReleaseRelevant(path, directory) {
  if (!path.startsWith(`${directory}/`)) return false;
  // Historical run data is absent from Smither's published dist/README package.
  // Only removal of known run artifacts is exempt; source/config edits still require notes.
  const archivedSmitherRun =
    directory === "packages/smither" &&
    removed.has(path) &&
    /^packages\/smither\/\.smithers\/(?:executions\/[^/]+\/logs\/stream\.ndjson|runs\/[^/]+\/(?:plan\.json|run\.json|smithers\.sqlite(?:-shm|-wal)?))$/.test(
      path,
    );
  // These paired unit moves do not enter Smither's explicit index/CLI build entries.
  return !archivedSmitherRun && !relocatedSmitherUnits.has(path);
}
const notes = readdirSync(".changeset")
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => readFileSync(join(".changeset", name), "utf8"))
  .join("\n");
const directories = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`);
for (const directory of directories) {
  if (
    !existsSync(`${directory}/package.json`) ||
    !changed.some((path) => isReleaseRelevant(path, directory))
  )
    continue;
  const manifest = JSON.parse(
    readFileSync(`${directory}/package.json`, "utf8"),
  );
  if (manifest.private) continue;
  const escaped = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasChangeset = new RegExp(
    `^["']?${escaped}["']?:\\s*(patch|minor|major)\\s*$`,
    "m",
  ).test(notes);
  const changelogPath = `${directory}/CHANGELOG.md`;
  let previousVersion;
  try {
    previousVersion = JSON.parse(
      execFileSync("git", ["show", `${base}:${directory}/package.json`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).version;
  } catch {
    // A new public package has no manifest at the base revision.
  }
  const versionEscaped = manifest.version.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const hasReleasedChangelog =
    changed.includes(changelogPath) &&
    existsSync(changelogPath) &&
    previousVersion !== manifest.version &&
    new RegExp(`^##\\s+\\[?${versionEscaped}\\]?(?:\\s|$)`, "m").test(
      readFileSync(changelogPath, "utf8"),
    );
  if (!hasChangeset && !hasReleasedChangelog)
    throw new Error(
      `Changed public package ${manifest.name} needs a changeset or a versioned changelog entry`,
    );
}
console.log(`Changed public packages have release notes against ${base}.`);
