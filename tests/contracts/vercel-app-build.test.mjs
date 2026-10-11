import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildVercelApp, vercelApp } from "../../scripts/build-vercel-app.mjs";
import projects from "../../scripts/vercel-projects.json" with { type: "json" };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aomi-vercel-app-"));
  const output = join(root, ".vercel/output");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "wrong-host.txt"), "cached Landing output");
  return {
    root,
    output,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("root builds select all five registered projects and publish only that host's artifact", () => {
  assert.equal(Object.keys(projects).length, 5);
  assert.deepEqual([...new Set(Object.values(projects))].sort(), [
    "build",
    "landing",
    "portal",
    "telegram",
  ]);
  for (const [id, app] of Object.entries(projects)) {
    const setup = fixture();
    try {
      const env = { VERCEL: "1", VERCEL_PROJECT_ID: id };
      const source = join(setup.root, "apps", app, ".vercel/output");
      mkdirSync(source, { recursive: true });
      writeFileSync(
        join(source, "config.json"),
        JSON.stringify({ app: "stale" }),
      );
      writeFileSync(join(source, "stale.txt"), "stale selected host");
      const result = buildVercelApp(
        setup.root,
        env,
        (command, args, options) => {
          assert.equal(command, "pnpm");
          assert.deepEqual(args, [
            "--fail-if-no-match",
            "--filter",
            app === "build" ? "aomi-build" : app,
            "build",
          ]);
          assert.equal(options.cwd, setup.root);
          assert.equal(options.env, env);
          assert.equal(existsSync(setup.output), false);
          assert.equal(existsSync(source), false);
          mkdirSync(source, { recursive: true });
          writeFileSync(
            join(source, "config.json"),
            JSON.stringify({ version: 3, app }),
          );
          symlinkSync("config.json", join(source, "relative-link"));
          return { status: 0 };
        },
      );
      assert.equal(result, app);
      assert.equal(
        JSON.parse(readFileSync(join(setup.output, "config.json"))).app,
        app,
      );
      assert.equal(
        readlinkSync(join(setup.output, "relative-link")),
        "config.json",
      );
      assert.equal(existsSync(join(setup.output, "wrong-host.txt")), false);
      assert.equal(existsSync(join(setup.output, "stale.txt")), false);
    } finally {
      setup.close();
    }
  }
});

test("missing, unknown or prototype project IDs cannot silently build Landing", () => {
  for (const id of [
    undefined,
    "",
    "prj_unregistered",
    "constructor",
    "__proto__",
  ])
    assert.throws(
      () => vercelApp({ VERCEL: "1", VERCEL_PROJECT_ID: id }),
      /Unknown Vercel project/,
    );
  for (const flag of [undefined, "", "0"])
    assert.throws(
      () =>
        vercelApp({
          VERCEL: flag,
          VERCEL_PROJECT_ID: Object.keys(projects)[0],
        }),
      /requires exposed system environment variables/,
    );
});

test("failed or empty builds cannot reuse cached selected-host or root artifacts", () => {
  const env = { VERCEL: "1", VERCEL_PROJECT_ID: Object.keys(projects)[0] };
  for (const result of [
    { status: 1 },
    { status: null },
    { error: new Error("spawn failed") },
    { status: 0 },
  ]) {
    const setup = fixture();
    try {
      const source = join(setup.root, "apps", "portal", ".vercel/output");
      mkdirSync(source, { recursive: true });
      writeFileSync(
        join(source, "config.json"),
        JSON.stringify({ version: 3 }),
      );
      assert.throws(() =>
        buildVercelApp(setup.root, env, () => {
          assert.equal(existsSync(source), false);
          return result;
        }),
      );
      assert.equal(existsSync(setup.output), false);
      assert.equal(existsSync(source), false);
    } finally {
      setup.close();
    }
  }
});
