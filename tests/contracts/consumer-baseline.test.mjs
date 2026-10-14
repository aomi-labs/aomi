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
import {
  copyTrustedConsumer,
  trustedConsumerImporters,
  trustedConsumers,
} from "../../scripts/check-consumer-compatibility-baseline.mjs";

for (const paths of [
  ["apps/examples/headless-client", "apps/widget-consumer"],
  ["examples/headless", "examples/embed-vite"],
  ["apps/widget-consumer", "examples/embed-vite"],
  ["examples/headless"],
]) {
  test(`selects only trusted consumers: ${paths.join(", ")}`, () => {
    const repo = mkdtempSync(join(tmpdir(), "consumer-selection-test-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    try {
      git("init", "-q");
      for (const path of paths) {
        mkdirSync(join(repo, path), { recursive: true });
        writeFileSync(join(repo, path, "package.json"), '{"name":"base"}\n');
      }
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
      for (const path of ["examples/headless", "examples/embed-vite"]) {
        mkdirSync(join(repo, path), { recursive: true });
        writeFileSync(
          join(repo, path, "package.json"),
          '{"name":"candidate"}\n',
        );
      }
      git("add", ".");
      const selected = trustedConsumers(repo, base);
      assert.deepEqual(
        selected.map(({ path }) => path),
        paths,
      );
      assert.deepEqual(
        trustedConsumers(repo, base, true),
        selected.filter(({ kind }) => kind === "widget"),
      );
      const widgetPaths = selected
        .filter(({ kind }) => kind === "widget")
        .map(({ path }) => path);
      const lockfile = `importers:\n${[
        ...widgetPaths,
        ...(paths.includes("apps/widget-consumer")
          ? ["apps/shadcn-registry"]
          : []),
      ]
        .map(
          (path, index) =>
            `  ${path}:\n    dependencies:\n      react:\n        specifier: ^19\n        version: 19.2.${index}\n`,
        )
        .join("\n")}`;
      const importers = trustedConsumerImporters(lockfile, selected);
      assert.deepEqual(Object.keys(importers.widgets), widgetPaths);
      widgetPaths.forEach((path, index) =>
        assert.equal(importers.widgets[path].react, `19.2.${index}`),
      );
      if (widgetPaths.length) {
        // Existing fixtures with broken baseline lockfiles must still fail.
        assert.throws(
          () => trustedConsumerImporters("importers:\n  .:\n", selected),
          /Trusted lockfile lacks importer/,
        );
      }
      for (const { path } of selected) {
        copyTrustedConsumer(repo, base, path, join(repo, "isolated"));
        assert.equal(
          readFileSync(join(repo, "isolated", path, "package.json"), "utf8"),
          '{"name":"base"}\n',
        );
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

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
