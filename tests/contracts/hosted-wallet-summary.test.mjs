import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readFileSync } from "node:fs";
import HostedWalletReporter from "../../.github/scripts/hosted-wallet-reporter.mjs";
import { summarize } from "../../.github/scripts/hosted-wallet-summary.mjs";

test("hosted wallet evidence uses the exact trusted main workflow commit", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/hosted-wallet-e2e.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: refs\/heads\/main/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
});

test("wallet login waits for and dismisses staging cookie consent before sign-in", () => {
  const journeys = readFileSync(
    new URL("../e2e/hosted-wallet-journeys.spec.ts", import.meta.url),
    "utf8",
  );
  const wait = journeys.indexOf('declineCookies.waitFor({ state: "visible"');
  const decline = journeys.indexOf("await declineCookies.click()");
  const signIn = journeys.indexOf(
    'page.getByRole("button", { name: "Sign in", exact: true }).click',
  );
  assert.ok(wait >= 0 && wait < decline && decline < signIn);
  assert.doesNotMatch(journeys, /localStorage\.setItem\("aomi-cookie-consent"/);
});

test("checkout SHA mismatch explicitly fails the Playwright run", () => {
  const previousSha = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = "0".repeat(40);
  try {
    assert.deepEqual(
      new HostedWalletReporter().onEnd({ status: "passed" }),
      { status: "failed" },
    );
  } finally {
    if (previousSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousSha;
  }
});

test("summary generation errors explicitly fail the Playwright run", () => {
  const previousSha = process.env.GITHUB_SHA;
  const previousRunId = process.env.GITHUB_RUN_ID;
  process.env.GITHUB_SHA = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  process.env.GITHUB_RUN_ID = "token=SECRET";
  try {
    assert.deepEqual(
      new HostedWalletReporter().onEnd({ status: "passed" }),
      { status: "failed" },
    );
  } finally {
    if (previousSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousSha;
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
  }
});

const input = () => ({
  sourceSha: "a".repeat(40),
  runId: "123",
  startedAt: "2026-10-15T00:00:00.000Z",
  finishedAt: "2026-10-15T00:00:01.000Z",
  total: 1,
  attempts: [{ status: "passed", retry: 0 }],
  fullStatus: "passed",
});

test("only all executed passing cases produce PASS", () => {
  assert.equal(summarize(input()).status, "PASS");
  for (const status of ["failed", "timedOut", "interrupted"]) {
    assert.equal(
      summarize({ ...input(), attempts: [{ status, retry: 0 }] }).status,
      "FAIL",
    );
  }
  for (const override of [
    { total: 0, attempts: [] },
    { attempts: [] },
    { attempts: [{ status: "skipped", retry: 0 }] },
    { attempts: [{ status: "passed", retry: 1 }] },
  ]) {
    assert.notEqual(summarize({ ...input(), ...override }).status, "PASS");
  }
  assert.equal(summarize({ ...input(), fullStatus: "failed" }).status, "FAIL");
});

test("retry success retains original failure and flaky count", () => {
  const result = summarize({
    ...input(),
    attempts: [
      { status: "failed", retry: 0 },
      { status: "passed", retry: 1 },
    ],
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.failures, 1);
  assert.equal(result.flaky, 1);
  assert.equal(result.retries, 1);
});

test("summary contains no raw diagnostics, titles, tokens or arbitrary metadata", () => {
  const value = input();
  value.attempts[0].error = "SECRET";
  value.attempts[0].title = "SECRET";
  const result = summarize({
    ...value,
    cookie: "SECRET",
    portalUrl: "https://SECRET",
  });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.equal(result.portalUrl, "https://chat-staging.aomi.dev");
  assert.equal(result.chainId, 84532);
  assert.throws(() => summarize({ ...input(), sourceSha: "SECRET" }));
  assert.throws(() => summarize({ ...input(), runId: "token=SECRET" }));
});
