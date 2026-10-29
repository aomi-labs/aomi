#!/usr/bin/env node
// Every Vercel project builds from the repository root with this one command,
// so it picks the app from VERCEL_PROJECT_ID and hands Vercel that app's Build
// Output (Nitro's `vercel` preset writes it to apps/<app>/.vercel/output).
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PROJECT_SURFACES } from "./vercel-ignore-build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Surface → [pnpm package, app directory]. */
const APPS = {
  portal: ["portal", "apps/portal"],
  build: ["aomi-build", "apps/build"],
  landing: ["landing", "apps/landing"],
};

const surface = process.env.AOMI_VERCEL_APP || PROJECT_SURFACES[process.env.VERCEL_PROJECT_ID];
const app = APPS[surface];
if (!app) {
  console.error(`No app for Vercel project ${process.env.VERCEL_PROJECT_ID}; set AOMI_VERCEL_APP to portal, build or landing`);
  process.exit(1);
}
const [pkg, dir] = app;
execFileSync("pnpm", ["--filter", pkg, "build"], { cwd: ROOT, stdio: "inherit" });
rmSync(resolve(ROOT, ".vercel/output"), { recursive: true, force: true });
cpSync(resolve(ROOT, dir, ".vercel/output"), resolve(ROOT, ".vercel/output"), { recursive: true });
