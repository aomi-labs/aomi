import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTrustedConsumer } from "../../scripts/check-consumer-compatibility-baseline.mjs";

test("candidate consumer edits cannot rewrite the trusted baseline", () => {
  const temp = mkdtempSync(join(tmpdir(), "consumer-baseline-test-"));
  const repo = join(temp, "repo");
  const consumer = "apps/examples/headless-client";
  const path = join(repo, consumer);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    mkdirSync(path, { recursive: true });
    git("init", "-q");
    writeFileSync(join(path, "package.json"), '{"name":"example"}\n');
    writeFileSync(
      join(path, "consumer.ts"),
      'import { Aomi } from "@aomi-labs/client";\n',
    );
    git("add", ".");
    git(
      "-c",
      "user.name=CI",
      "-c",
      "user.email=ci@example.test",
      "commit",
      "-qm",
      "baseline",
    );
    const base = git("rev-parse", "HEAD");

    // An agent updates the local example in the same change as a breaking SDK.
    writeFileSync(
      join(path, "consumer.ts"),
      'import { NewAomi } from "@aomi-labs/client";\n',
    );
    git("add", ".");
    git(
      "-c",
      "user.name=CI",
      "-c",
      "user.email=ci@example.test",
      "commit",
      "-qm",
      "candidate",
    );
    copyTrustedConsumer(repo, base, consumer, join(temp, "isolated"));
    assert.equal(
      readFileSync(join(temp, "isolated", consumer, "consumer.ts"), "utf8"),
      'import { Aomi } from "@aomi-labs/client";\n',
    );
    assert.throws(
      () =>
        copyTrustedConsumer(repo, base, "apps/missing", join(temp, "missing")),
      /Missing base consumer/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

for (const baseline of [
  undefined,
  "0000000000000000000000000000000000000000",
  "does-not-exist",
]) {
  test(`missing or invalid baseline fails closed: ${baseline ?? "missing"}`, () => {
    const env = { ...process.env };
    delete env.CONSUMER_BASE_SHA;
    const result = spawnSync(
      process.execPath,
      [
        new URL(
          "../../scripts/check-consumer-compatibility.mjs",
          import.meta.url,
        ).pathname,
        ...(baseline ? ["--base", baseline] : []),
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Checking consumers/);
  });
}
