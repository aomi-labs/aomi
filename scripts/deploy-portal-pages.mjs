#!/usr/bin/env node
// Build the Portal for Cloudflare and publish it to an environment's private
// page Worker (apps/portal/pages.json). The page Worker has no route, secret
// or binding: the edge Worker is its only ingress and serves whichever version
// is live, so publishing here is the whole frontend deploy.
//
//   node scripts/deploy-portal-pages.mjs staging            # build, smoke, publish
//   node scripts/deploy-portal-pages.mjs staging --dry-run  # build and smoke only
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = resolve(ROOT, "apps/portal/.output/server");
// Wallet sign-in is disabled without these, so a build without them is not deployable.
const REQUIRED_PUBLIC_ENV = [
  "NEXT_PUBLIC_PARA_API_KEY",
  "NEXT_PUBLIC_PARA_ENVIRONMENT",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_PROJECT_ID",
];

/** One environment's page record, checked against the Portal's public build settings. */
export function portalPage(records, environment, publicKeys) {
  const page = records[environment];
  if (!page)
    throw new Error(`apps/portal/pages.json has no ${environment} record`);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(page.script ?? ""))
    throw new Error("Portal page script must be a Worker name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(page.compatibilityDate ?? ""))
    throw new Error("Portal pages need a pinned compatibilityDate");
  const publicEnv = page.publicEnv ?? {};
  for (const [name, value] of Object.entries(publicEnv)) {
    if (
      !publicKeys.includes(name) ||
      typeof value !== "string" ||
      /[\r\n]/.test(value)
    )
      throw new Error(`Invalid Portal public build setting ${name}`);
  }
  for (const name of REQUIRED_PUBLIC_ENV) {
    if (!publicEnv[name]?.trim())
      throw new Error(`Portal pages require ${name}`);
  }
  return {
    script: page.script,
    compatibilityDate: page.compatibilityDate,
    publicEnv,
  };
}

/** The Worker config to upload: the build's entry and assets, and nothing it could reach with. */
export function pageConfig(generated, page) {
  if (
    generated.main !== "index.mjs" ||
    generated.assets?.directory !== "../public"
  )
    throw new Error("Unexpected Nitro Cloudflare output layout");
  if (!generated.compatibility_flags?.includes("nodejs_compat"))
    throw new Error("Portal output requires nodejs_compat");
  return {
    main: generated.main,
    assets: generated.assets,
    no_bundle: generated.no_bundle,
    rules: generated.rules,
    compatibility_flags: generated.compatibility_flags,
    name: page.script,
    compatibility_date: page.compatibilityDate,
    workers_dev: false,
    preview_urls: false,
    routes: [],
    triggers: { crons: [] },
    services: [],
    vars: {},
    observability: { enabled: true },
    version_metadata: { binding: "CF_VERSION_METADATA" },
  };
}

function pnpm(args, env) {
  const result = spawnSync("pnpm", args, { cwd: ROOT, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed`);
}

/** Serve the built Worker locally and require the page and one of its scripts. */
async function smoke(config) {
  const port = await new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "aomi-edge",
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--config",
      config,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--show-interactive-dev-session=false",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  try {
    await new Promise((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`Local page Worker did not start:\n${log}`)),
        90_000,
      );
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
          log += chunk;
          if (log.includes(`Ready on ${base}`)) {
            clearTimeout(timer);
            done();
          }
        });
      }
      child.once("exit", (code) => {
        clearTimeout(timer);
        fail(new Error(`wrangler dev exited ${code}:\n${log}`));
      });
    });
    const page = await fetch(`${base}/`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await page.text();
    if (page.status !== 200 || !html.includes("<html"))
      throw new Error(`Page smoke failed: / returned ${page.status}`);
    const asset = html.match(/(?:src|href)="(\/_build\/[^"?]+\.js)/);
    if (!asset)
      throw new Error("Page smoke failed: no built script in the page");
    const built = await fetch(`${base}${asset[1]}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (built.status !== 200)
      throw new Error(
        `Page smoke failed: ${asset[1]} returned ${built.status}`,
      );
    console.log(`Page smoke passed: / and ${asset[1]}`);
  } finally {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already exited.
    }
  }
}

export async function deploy(
  environment,
  { dryRun = false, env = process.env } = {},
) {
  const page = portalPage(
    JSON.parse(readFileSync(resolve(ROOT, "apps/portal/pages.json"), "utf8")),
    environment,
    JSON.parse(
      readFileSync(resolve(ROOT, "apps/portal/public-env.keys.json"), "utf8"),
    ),
  );
  const source = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(source))
    throw new Error("Could not read the source revision");
  if (!dryRun && !env.CLOUDFLARE_API_TOKEN?.trim())
    throw new Error(
      "CLOUDFLARE_API_TOKEN must be set to publish the Portal pages",
    );
  const buildEnv = {
    ...env,
    ...page.publicEnv,
    AOMI_DEPLOY_TARGET: "cloudflare",
    AOMI_DEPLOY_STAGE: "preview",
    GITHUB_SHA: source,
  };
  pnpm(["--filter", "portal", "build"], buildEnv);
  const config = resolve(SERVER, "wrangler.pages.json");
  try {
    writeFileSync(
      config,
      JSON.stringify(
        pageConfig(
          JSON.parse(readFileSync(resolve(SERVER, "wrangler.json"), "utf8")),
          page,
        ),
        null,
        2,
      ),
    );
    await smoke(config);
    if (dryRun) return console.log(`Dry run: ${page.script} not published`);
    pnpm(
      [
        "--filter",
        "aomi-edge",
        "exec",
        "wrangler",
        "deploy",
        "--config",
        config,
        "--tag",
        source,
        "--message",
        `portal:${source}`,
      ],
      buildEnv,
    );
    console.log(`Published aomi@${source} to ${page.script}`);
  } finally {
    rmSync(config, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  deploy(process.argv[2], { dryRun: process.argv.includes("--dry-run") }).catch(
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
