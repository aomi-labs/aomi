import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import projects from "./vercel-projects.json" with { type: "json" };

const packages = {
  portal: "portal",
  build: "aomi-build",
  landing: "landing",
  telegram: "telegram",
};

/** Root-directory projects must select a host before any build or output copy. */
export function vercelApp(env) {
  assert.equal(
    env.VERCEL,
    "1",
    "Root Vercel publishing requires exposed system environment variables",
  );
  const app = Object.hasOwn(projects, env.VERCEL_PROJECT_ID ?? "")
    ? projects[env.VERCEL_PROJECT_ID]
    : undefined;
  assert.ok(
    app,
    "Unknown Vercel project: select an app root or register its public project ID",
  );
  return app;
}

export function buildVercelApp(root, env, run = spawnSync) {
  const app = vercelApp(env);
  const output = join(root, ".vercel/output");
  const source = join(root, "apps", app, ".vercel/output");
  // A failed build must not leave a cached artifact from a different host publishable.
  rmSync(output, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
  const result = run(
    "pnpm",
    ["--fail-if-no-match", "--filter", packages[app], "build"],
    {
      cwd: root,
      env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Native ${app} build failed`);
  assert.ok(
    existsSync(join(source, "config.json")),
    `Missing native ${app} Vercel artifact`,
  );
  cpSync(source, output, { recursive: true, verbatimSymlinks: true });
  return app;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  buildVercelApp(
    fileURLToPath(new URL("../../", import.meta.url)),
    process.env,
  );
