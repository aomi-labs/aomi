import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const contracts = readFileSync(
  new URL(
    "../../.github/workflows/widget-package-contracts.yml",
    import.meta.url,
  ),
  "utf8",
);

function job(name) {
  const block = ci.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"),
  );
  assert.ok(block, `Missing required job ${name}`);
  return block[1];
}

test("main CI calls the full widget guard without duplicate PR runs", () => {
  const guard = job("widget-contracts");
  // The guard installs and builds on its own, so it must not wait for (or be
  // skipped by) the Packages job.
  assert.match(guard, /needs: changes\n/);
  assert.match(guard, /if: needs\.changes\.outputs\.consumer_compat == 'true'/);
  assert.match(
    guard,
    /uses: \.\/\.github\/workflows\/widget-package-contracts\.yml/,
  );
  assert.match(contracts, /^  workflow_call:/m);
  assert.doesNotMatch(contracts, /^  pull_request:/m);
  // Same-SHA main runs remain the publication proof required by the tag workflow.
  assert.match(contracts, /^  push:\n    branches: \[main\]/m);
  for (const command of [
    "check:package-changesets",
    "check:package-api",
    "check:fresh-widget",
  ])
    assert.ok(contracts.includes(command), `Missing guard ${command}`);
  assert.match(contracts, /repository: aomi-labs\/docs/);
  assert.match(contracts, /AOMI_DOCS_DIRECTORY:/);
});

test("Frontend CI Passed fails closed when selected widget coverage is missing", () => {
  const aggregate = job("all-checks");
  assert.match(aggregate, /\bwidget-contracts,/);
  assert.match(
    aggregate,
    /WIDGET_CONTRACT_SELECTED: \$\{\{ needs\.changes\.outputs\.consumer_compat \}\}/,
  );
  assert.match(
    aggregate,
    /WIDGET_CONTRACT_RESULT: \$\{\{ needs\.widget-contracts\.result \}\}/,
  );
  const run = aggregate.match(/        run: \|\n([\s\S]*)/);
  assert.ok(run, "Missing actual aggregate shell");
  const script = run[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const env = {
    PATH: process.env.PATH,
    CHANGES_RESULT: "success",
    PROMOTION_RESULT: "skipped",
    HOTFIX_RESULT: "skipped",
    PRODUCTION_CONTRACT_RESULT: "skipped",
    REQUIRE_PRODUCTION_CONTRACT: "false",
    PACKED_RESULT: "skipped",
  };
  for (const prefix of [
    "PACKAGES",
    "APPS",
    "JOURNEYS",
    "BROWSER",
    "CONSUMER",
    "WORKFLOW",
  ])
    Object.assign(env, {
      [`${prefix}_SELECTED`]: "false",
      [`${prefix}_RESULT`]: "skipped",
    });
  function status(selected, result) {
    return spawnSync("bash", ["-c", script], {
      env: {
        ...env,
        WIDGET_CONTRACT_SELECTED: selected,
        WIDGET_CONTRACT_RESULT: result,
      },
      encoding: "utf8",
    }).status;
  }
  assert.equal(status("true", "success"), 0);
  assert.equal(status("false", "skipped"), 0);
  for (const result of ["failure", "skipped", "cancelled", ""])
    assert.notEqual(
      status("true", result),
      0,
      `Selected guard incorrectly accepted ${result}`,
    );
  assert.notEqual(status("false", "success"), 0);
});
