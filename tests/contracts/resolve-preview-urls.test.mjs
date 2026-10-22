import test from "node:test";
import assert from "node:assert/strict";
import {
  immutableURL,
  selectDeployment,
  successfulURL,
  resolve,
} from "../../.github/scripts/resolve-preview-urls.mjs";
const sha = "a".repeat(40);
test("only exact source/environment and latest deployment", () => {
  assert.equal(
    selectDeployment(
      [
        { id: 1, sha, environment: "Preview – chat-portal" },
        { id: 3, sha: "b".repeat(40), environment: "Preview – chat-portal" },
        { id: 2, sha, environment: "Preview – chat-portal" },
      ],
      "Preview – chat-portal",
      sha,
    ).id,
    2,
  );
});
test("immutable origin and current status required", () => {
  for (const value of [
    "https://bad.vercel.app.evil.org",
    "https://u:p@ok.vercel.app",
    "https://ok.vercel.app/path",
    "http://ok.vercel.app",
  ])
    assert.equal(immutableURL(value), null);
  assert.equal(
    successfulURL([
      { id: 1, state: "success", environment_url: "https://ok.vercel.app" },
      { id: 2, state: "pending" },
    ]),
    null,
  );
  assert.throws(() =>
    successfulURL([
      { id: 2, state: "failure" },
      { id: 1, state: "success", environment_url: "https://ok.vercel.app" },
    ]),
  );
});
test("delayed Portal does not starve Build; both exact URLs are required", async () => {
  let time = 0;
  const output = [];
  await resolve({
    sha,
    seconds: 3,
    now: () => time,
    wait: async () => {
      time += 1000;
    },
    log: () => {},
    output: (...row) => output.push(row),
    read: async (path) => {
      if (path.startsWith("deployments?"))
        return [
          { id: 1, sha, environment: "Preview – aomi-build" },
          ...(time >= 1000
            ? [{ id: 2, sha, environment: "Preview – chat-portal" }]
            : []),
        ];
      return [
        {
          id: 1,
          state: "success",
          environment_url: `https://${path.includes("/1/") ? "build" : "portal"}.vercel.app`,
        },
      ];
    },
  });
  assert.deepEqual(output, [
    ["build_url", "https://build.vercel.app"],
    ["portal_url", "https://portal.vercel.app"],
  ]);
});
test("missing publication fails with a queue diagnosis", async () => {
  let time = 0;
  await assert.rejects(
    resolve({
      sha,
      seconds: 1,
      now: () => time,
      wait: async () => {
        time += 1000;
      },
      log: () => {},
      output: () => {},
      read: async () => [],
    }),
    /QA has not run/,
  );
});
