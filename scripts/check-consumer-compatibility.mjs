#!/usr/bin/env node
// Compile consumers from the trusted base against the packages this checkout ships.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTrustedConsumer } from "./check-consumer-compatibility-baseline.mjs";
import {
  importerResolution,
  importerVersions,
  packageVersion,
} from "./consumer-lockfile.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).packageManager;
const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = baseFlag >= 0 ? args[baseFlag + 1] : process.env.CONSUMER_BASE_SHA;
const outputFlag = args.indexOf("--browser-output");
const browserOutput =
  outputFlag >= 0 ? args[outputFlag + 1] : process.env.CONSUMER_BROWSER_OUTPUT;
const onlyWidget = args.includes("--only-widget");
const consumerHeapMb = Number(process.env.CONSUMER_NODE_HEAP_MB ?? "5120");
if (!Number.isSafeInteger(consumerHeapMb) || consumerHeapMb < 1024) {
  throw new Error("CONSUMER_NODE_HEAP_MB must be an integer of at least 1024");
}
const nodeOptions = `${(process.env.NODE_OPTIONS ?? "")
  .replace(/--max-old-space-size(?:=|\s+)\d+/g, "")
  .trim()} --max-old-space-size=${consumerHeapMb}`.trim();
if (
  !base ||
  /^0+$/.test(base) ||
  args.some(
    (arg, i) =>
      (arg === "--base" || arg === "--browser-output") && !args[i + 1],
  )
) {
  throw new Error(
    "Pass --base <trusted commit SHA> or CONSUMER_BASE_SHA; browser output paths require a value",
  );
}
const sha = execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], {
  cwd: root,
  encoding: "utf8",
}).trim();
const temporary = mkdtempSync(join(tmpdir(), "aomi-consumer-compat-"));
const packages = [
  ["@aomi-labs/client", "packages/client"],
  ["@aomi-labs/react", "packages/react"],
  ["@aomi-labs/deploy", "packages/deploy"],
  ["@aomi-labs/widget-lib", "apps/shadcn-registry"],
].filter(([name]) => !onlyWidget || name !== "@aomi-labs/deploy");
const consumers = onlyWidget
  ? ["apps/widget-consumer"]
  : ["apps/examples/headless-client", "apps/widget-consumer"];

function run(command, commandArgs, cwd = root) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true", NODE_OPTIONS: nodeOptions },
  });
}

function baseFile(path) {
  return execFileSync("git", ["show", `${sha}:${path}`], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function verifyHostCompositionExport(destination) {
  const typeCheckPath = join(destination, "host-composition-check.ts");
  writeFileSync(
    typeCheckPath,
    `import {
  HeaderControls,
  getBackendUrl,
  type UsageFixtureData,
} from "@aomi-labs/widget-lib/host-composition";

export const HostHeader: typeof HeaderControls = HeaderControls;
export const backendUrl: string = getBackendUrl();
export type HostUsage = UsageFixtureData;
`,
  );
  run(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsc",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--skipLibCheck",
      typeCheckPath,
    ],
    destination,
  );

  const resolutionCheckPath = join(destination, "host-composition-resolve.mjs");
  writeFileSync(
    resolutionCheckPath,
    `const resolved = import.meta.resolve("@aomi-labs/widget-lib/host-composition");
if (!resolved.endsWith("/dist/host-composition.js")) {
  throw new Error(\`Packed host-composition export resolved to \${resolved}\`);
}
`,
  );
  run("node", [resolutionCheckPath], destination);
}

function verifyFreshInstall(tarballs, temporaryRoot) {
  const clientManifest = JSON.parse(
    readFileSync(join(root, "packages/client/package.json"), "utf8"),
  );
  const widgetDestination = join(temporaryRoot, "fresh-widget-install");
  const widgetManifest = {
    name: "aomi-clean-widget-install-contract",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager,
    dependencies: {
      "@aomi-labs/widget-lib": tarballs["@aomi-labs/widget-lib"],
      react: "19.2.0",
      "react-dom": "19.2.0",
    },
    devDependencies: {
      "@vitejs/plugin-react": "^4.7.0",
      vite: "^7.2.2",
      "vite-plugin-node-polyfills": "^0.28.0",
    },
    pnpm: { overrides: tarballs },
  };
  mkdirSync(widgetDestination, { recursive: true });
  writeFileSync(
    join(widgetDestination, "package.json"),
    `${JSON.stringify(widgetManifest, null, 2)}\n`,
  );
  run(
    "corepack",
    [
      "pnpm",
      "install",
      "--no-frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies=false",
    ],
    widgetDestination,
  );
  writeFileSync(
    join(widgetDestination, "index.html"),
    '<div id="root"></div><script type="module" src="/main.jsx"></script>\n',
  );
  writeFileSync(
    join(widgetDestination, "main.jsx"),
    `import React from "react";
import { createRoot } from "react-dom/client";
import { AomiWidget } from "@aomi-labs/widget-lib";
import "@aomi-labs/widget-lib/styles.css";
createRoot(document.getElementById("root")).render(
  React.createElement(AomiWidget, { applicationId: "1", apiUrl: "https://example.invalid" }),
);
`,
  );
  writeFileSync(
    join(widgetDestination, "vite.config.mjs"),
    `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util"] })],
  resolve: { dedupe: ["react", "react-dom"] },
});
`,
  );
  run("corepack", ["pnpm", "exec", "vite", "build"], widgetDestination);

  const sdkDestination = join(temporaryRoot, "fresh-sdk-install");
  const sdkManifest = {
    name: "aomi-clean-sdk-install-contract",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager,
    dependencies: {
      "@aomi-labs/client": tarballs["@aomi-labs/client"],
      "@aomi-labs/deploy": tarballs["@aomi-labs/deploy"],
      "@aomi-labs/react": tarballs["@aomi-labs/react"],
      "@assistant-ui/react": "^0.14.0",
      react: "19.2.0",
      "react-dom": "19.2.0",
    },
    pnpm: { overrides: tarballs },
  };
  mkdirSync(sdkDestination, { recursive: true });
  writeFileSync(
    join(sdkDestination, "package.json"),
    `${JSON.stringify(sdkManifest, null, 2)}\n`,
  );
  run(
    "corepack",
    [
      "pnpm",
      "install",
      "--no-frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies=false",
    ],
    sdkDestination,
  );
  const sdkRuntimeCheck = join(sdkDestination, "runtime-check.mjs");
  writeFileSync(
    sdkRuntimeCheck,
    `import { Aomi, AomiClient } from "@aomi-labs/client";
import { AomiRuntimeProvider } from "@aomi-labs/react";
import { deploymentLifecycleFromProject } from "@aomi-labs/deploy/lifecycle";
for (const [name, value] of Object.entries({ Aomi, AomiClient, AomiRuntimeProvider, deploymentLifecycleFromProject })) {
  if (typeof value !== "function") throw new Error(\`Fresh SDK install lacks \${name}\`);
}
`,
  );
  run("node", [sdkRuntimeCheck], sdkDestination);

  const version = execFileSync(
    join(sdkDestination, "node_modules/.bin/aomi"),
    ["--version"],
    { cwd: sdkDestination, encoding: "utf8" },
  ).trim();
  if (!version.includes(clientManifest.version)) {
    throw new Error(
      `Packed CLI version mismatch: expected ${clientManifest.version}, got ${version}`,
    );
  }
}

try {
  console.log(
    `Checking consumers from ${sha} against candidate package tarballs`,
  );
  const tarballs = {};
  const trustedLockfile = baseFile("pnpm-lock.yaml").toString("utf8");
  const trustedImporters = {
    root: importerVersions(trustedLockfile, "."),
    widget: importerVersions(trustedLockfile, "apps/widget-consumer"),
    registry: importerVersions(trustedLockfile, "apps/shadcn-registry"),
  };
  const trustedTap = packageVersion(
    trustedLockfile,
    "@assistant-ui/tap",
    importerResolution(trustedLockfile, ".", "@assistant-ui/react-ai-sdk"),
  );
  for (const [name, path] of packages) {
    if (name === "@aomi-labs/widget-lib" || name === "@aomi-labs/deploy") {
      // These packages have no prepack hook; build before producing the
      // exact archive consumed by the clean-install fixture.
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

  if (!onlyWidget) verifyFreshInstall(tarballs, temporary);

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
      manifest.dependencies["@assistant-ui/react"] =
        trustedImporters.root["@assistant-ui/react"];
      const baseWidget = JSON.parse(
        baseFile("apps/shadcn-registry/package.json").toString("utf8"),
      );
      manifest.dependencies["@solana/spl-token"] ??=
        baseWidget.devDependencies?.["@solana/spl-token"];
      if (!manifest.dependencies["@solana/spl-token"])
        throw new Error("Trusted base lacks widget Solana peer");
      manifest.dependencies["@solana/spl-token"] =
        trustedImporters.registry["@solana/spl-token"];
    }
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (tarballs[name]) manifest[field][name] = tarballs[name];
        else if (String(manifest[field][name]).startsWith("workspace:")) {
          throw new Error(`Unmapped workspace package ${name} in ${consumer}`);
        } else if (consumer.endsWith("widget-consumer")) {
          const locked =
            trustedImporters.widget[name] ??
            (name === "@assistant-ui/react"
              ? trustedImporters.root[name]
              : undefined) ??
            (name === "@solana/spl-token"
              ? trustedImporters.registry[name]
              : undefined);
          if (!locked) {
            throw new Error(
              `Trusted lockfile lacks ${consumer} dependency ${name}`,
            );
          }
          manifest[field][name] = locked;
        }
      }
    }
    // Transitive dependencies must also use this candidate, not registry releases.
    manifest.pnpm = {
      ...manifest.pnpm,
      overrides: {
        ...manifest.pnpm?.overrides,
        ...trustedImporters.registry,
        ...trustedImporters.widget,
        "@assistant-ui/react": trustedImporters.root["@assistant-ui/react"],
        "@assistant-ui/tap": trustedTap,
        "@types/node": trustedImporters.root["@types/node"],
        ...tarballs,
      },
    };
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
    if (consumer.endsWith("widget-consumer")) {
      // Exercise the packed subpath only after the unchanged trusted fixture
      // has built, reusing its candidate install without source aliases.
      verifyHostCompositionExport(destination);
    }
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
  if (browserOutput) {
    const widgetDirectory = join(temporary, "apps/widget-consumer");
    writeFileSync(
      resolve(root, browserOutput),
      `${JSON.stringify({
        trustedBase: sha,
        consumerDirectory: widgetDirectory,
        immutableSource: "apps/widget-consumer",
      })}\n`,
    );
  }
  console.log("Trusted-base consumers compile against candidate tarballs.");
} finally {
  if (process.env.KEEP_CONSUMER_COMPAT_DIR || browserOutput)
    console.log(`Retained ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
