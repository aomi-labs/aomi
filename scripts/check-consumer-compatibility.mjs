#!/usr/bin/env node
// Compile consumers from the trusted base against the packages this checkout ships.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTrustedConsumer } from "./check-consumer-compatibility-baseline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).packageManager;
const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = baseFlag >= 0 ? args[baseFlag + 1] : process.env.CONSUMER_BASE_SHA;
if (
  !base ||
  /^0+$/.test(base) ||
  args.some((arg, i) => arg === "--base" && !args[i + 1])
) {
  throw new Error("Pass --base <trusted commit SHA> or CONSUMER_BASE_SHA");
}
const sha = execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], {
  cwd: root,
  encoding: "utf8",
}).trim();
const temporary = mkdtempSync(join(tmpdir(), "aomi-consumer-compat-"));
const packages = [
  ["@aomi-labs/client", "packages/client"],
  ["@aomi-labs/react", "packages/react"],
  ["@aomi-labs/widget-lib", "apps/shadcn-registry"],
];
const consumers = ["apps/examples/headless-client", "apps/widget-consumer"];

function run(command, commandArgs, cwd = root) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

function baseFile(path) {
  return execFileSync("git", ["show", `${sha}:${path}`], { cwd: root });
}

try {
  console.log(
    `Checking consumers from ${sha} against candidate package tarballs`,
  );
  const tarballs = {};
  for (const [name, path] of packages) {
    if (name === "@aomi-labs/widget-lib") {
      // Widget has prepublishOnly rather than prepack.
      run("corepack", ["pnpm", "--dir", join(root, path), "build"]);
    }
    run("corepack", [
      "pnpm",
      "--dir",
      join(root, path),
      "pack",
      "--pack-destination",
      temporary,
    ]);
    const manifest = JSON.parse(
      readFileSync(join(root, path, "package.json"), "utf8"),
    );
    const actual = join(
      temporary,
      `${name.replaceAll("/", "-").replaceAll("@", "")}-${manifest.version}.tgz`,
    );
    // pnpm names scoped archives without the @ and slash.
    tarballs[name] = `file:${actual}`;
  }

  for (const consumer of consumers) {
    const destination = join(temporary, consumer);
    copyTrustedConsumer(root, sha, consumer, temporary);
    const manifestPath = join(destination, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.packageManager = packageManager;
    if (consumer.endsWith("widget-consumer")) {
      // The trusted workspace root supplied this peer to the original fixture.
      // Preserve its base version; candidate package changes cannot add peers.
      const baseRoot = JSON.parse(baseFile("package.json").toString("utf8"));
      manifest.dependencies["@assistant-ui/react"] ??=
        baseRoot.dependencies?.["@assistant-ui/react"] ??
        baseRoot.devDependencies?.["@assistant-ui/react"];
      if (!manifest.dependencies["@assistant-ui/react"])
        throw new Error("Trusted base lacks widget runtime peer");
      const baseWidget = JSON.parse(
        baseFile("apps/shadcn-registry/package.json").toString("utf8"),
      );
      manifest.dependencies["@solana/spl-token"] ??=
        baseWidget.devDependencies?.["@solana/spl-token"];
      if (!manifest.dependencies["@solana/spl-token"])
        throw new Error("Trusted base lacks widget Solana peer");
    }
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (tarballs[name]) manifest[field][name] = tarballs[name];
        else if (String(manifest[field][name]).startsWith("workspace:")) {
          throw new Error(`Unmapped workspace package ${name} in ${consumer}`);
        }
      }
    }
    // Transitive dependencies must also use this candidate, not registry releases.
    manifest.pnpm = { ...manifest.pnpm, overrides: tarballs };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (consumer.endsWith("headless-client")) {
      const tsconfigPath = join(destination, "tsconfig.json");
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
      delete tsconfig.compilerOptions.baseUrl;
      delete tsconfig.compilerOptions.paths;
      writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
    }
    run(
      "corepack",
      ["pnpm", "install", "--no-frozen-lockfile", "--ignore-scripts"],
      destination,
    );
    run("corepack", ["pnpm", "run", "build"], destination);
    if (consumer.endsWith("headless-client")) {
      run("corepack", ["pnpm", "run", "test"], destination);
      // Import from this install's node_modules so module resolution cannot
      // accidentally find a built artifact in the candidate checkout.
      const importPath = join(destination, "package-imports.mjs");
      writeFileSync(
        importPath,
        `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esm = await import("@aomi-labs/client");
const cjs = require("@aomi-labs/client");
if (!esm.Aomi || !cjs.Aomi) throw new Error("Packed client facade export missing");
`,
      );
      run("node", [importPath], destination);
    }
  }
  console.log("Trusted-base consumers compile against candidate tarballs.");
} finally {
  if (process.env.KEEP_CONSUMER_COMPAT_DIR)
    console.log(`Retained ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
