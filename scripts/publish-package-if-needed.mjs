#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

export async function publishPackageIfNeeded(
  packageDirectory,
  {
    fetchImpl = globalThis.fetch,
    publishImpl = publishWithPnpm,
    registryUrl = process.env.NPM_CONFIG_REGISTRY ??
      process.env.npm_config_registry ??
      DEFAULT_REGISTRY_URL,
  } = {},
) {
  const manifestPath = path.resolve(packageDirectory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageSpec = `${manifest.name}@${manifest.version}`;
  const versionUrl = [
    registryUrl.replace(/\/+$/, ""),
    encodeURIComponent(manifest.name).replace(/^%40/, "@"),
    encodeURIComponent(manifest.version),
  ].join("/");
  const isPublished = () =>
    checkPublishedVersion({ fetchImpl, packageSpec, versionUrl });

  if (await isPublished()) {
    console.log(`${packageSpec} is already published; skipping.`);
    return "skipped";
  }

  console.log(`${packageSpec} is not published; publishing now.`);
  try {
    await publishImpl(packageDirectory);
  } catch (error) {
    // A concurrent run may publish after our initial 404, or npm may accept a
    // PUT but return a transient error. Treat the package's durable registry
    // state as authoritative before failing the job.
    if (await isPublished()) {
      console.log(`${packageSpec} is now published; continuing.`);
      return "published";
    }
    throw error;
  }
  return "published";
}

async function checkPublishedVersion({ fetchImpl, packageSpec, versionUrl }) {
  let response;
  try {
    response = await fetchImpl(versionUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(
      `Could not check whether ${packageSpec} is published: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (response.ok) return true;
  if (response.status === 404) return false;

  const detail = (await response.text()).trim().slice(0, 500);
  throw new Error(
    `Registry check for ${packageSpec} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

/**
 * Publish through pnpm, NOT `npm publish`.
 *
 * Every publishable manifest here declares its siblings with pnpm's
 * `workspace:*` protocol. `pnpm publish` replaces that with the sibling's
 * concrete version in the PUBLISHED manifest; `npm publish` uploads the
 * manifest verbatim, and `workspace:*` is meaningless to an npm/yarn consumer
 * — the install fails to resolve it.
 *
 * This is not hypothetical. Publishing moved to `npm publish` in the release
 * hardening (fdbea398), and the first release after it shipped broken:
 *   @aomi-labs/widget@1.4.29 (pnpm) -> react 0.5.13, client 0.4.5   ✅
 *   @aomi-labs/widget@2.0.0  (npm)  -> react workspace:*, client workspace:*  ❌
 *   @aomi-labs/react@0.6.0       (npm)  -> client workspace:*                     ❌
 * The publish job went green both times; only the registry metadata differs,
 * so nothing caught it until a consumer tried to install. See the guard test
 * in scripts/publish-package-if-needed.test.mjs.
 *
 * `--no-git-checks` is required because the release workflow publishes from a
 * detached checkout of the candidate SHA. `--tag` is kept so NPM_DIST_TAG
 * still works for prereleases.
 */
function publishWithPnpm(packageDirectory) {
  return new Promise((resolve, reject) => {
    const args = ["publish", "--access", "public", "--no-git-checks"];
    const distTag = process.env.NPM_DIST_TAG?.trim();
    if (distTag) args.push("--tag", distTag);
    const child = spawn("pnpm", args, {
      cwd: path.resolve(packageDirectory),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `pnpm publish for ${packageDirectory} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function main() {
  const packageDirectory = process.argv[2];
  if (!packageDirectory) {
    throw new Error(
      "Usage: node scripts/publish-package-if-needed.mjs <package-directory>",
    );
  }
  await publishPackageIfNeeded(packageDirectory);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
