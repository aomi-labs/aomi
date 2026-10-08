#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import {
  CompilerState,
  Extractor,
  ExtractorConfig,
} from "@microsoft/api-extractor";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");
const widget = "packages/widget";
// Deprecated widget subpaths are pinned by src/compat-entries.test.ts instead.
const deprecatedEntries = new Set(
  Object.keys(
    JSON.parse(readFileSync(join(root, widget, "package-entries.json"), "utf8"))
      .deprecated,
  ).map((entry) => `./${entry}`),
);
const packages = ["packages/client", "packages/react", widget];
const reports = join(root, "api-reports");
const temporary = join(root, "output/package-api");
mkdirSync(reports, { recursive: true });
mkdirSync(temporary, { recursive: true });
for (const directory of packages) {
  const folder = join(root, directory);
  const manifest = JSON.parse(
    readFileSync(join(folder, "package.json"), "utf8"),
  );
  const id = manifest.name.replace("@", "").replaceAll("/", "-");
  const entries = new Map();
  function typePath(entry) {
    if (!entry || typeof entry === "string") return null;
    return entry.types ?? typePath(entry.import) ?? typePath(entry.require);
  }
  for (const [entry, condition] of Object.entries(manifest.exports ?? {})) {
    const path = typePath(condition);
    if (path && !(directory === widget && deprecatedEntries.has(entry)))
      entries.set(entry, join(folder, path));
  }
  if (!entries.size && manifest.types)
    entries.set(".", join(folder, manifest.types));
  let compilerState;
  for (const [entry, declaration] of entries) {
    const name = `${id}-${entry === "." ? "main" : entry.slice(2).replaceAll("/", "-")}`;
    const configPath = join(temporary, `${name}.json`);
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema:
            "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
          projectFolder: folder,
          mainEntryPointFilePath: declaration,
          compiler: {
            tsconfigFilePath: join(root, "tsconfig.json"),
            overrideTsconfig: {
              compilerOptions: {
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "Bundler",
                skipLibCheck: true,
                esModuleInterop: true,
                jsx: "react-jsx",
              },
              files: [...entries.values()],
            },
          },
          apiReport: {
            enabled: true,
            reportFileName: `${name}.api.md`,
            reportFolder: reports,
            reportTempFolder: temporary,
          },
          docModel: { enabled: false },
          dtsRollup: { enabled: false },
          tsdocMetadata: { enabled: false },
          messages: {
            compilerMessageReporting: { default: { logLevel: "error" } },
            extractorMessageReporting: {
              default: { logLevel: "warning", addToApiReportFile: false },
              "ae-missing-release-tag": { logLevel: "none" },
              "ae-undocumented": { logLevel: "none" },
              "ae-forgotten-export": { logLevel: "none" },
            },
            tsdocMessageReporting: { default: { logLevel: "none" } },
          },
        },
        null,
        2,
      ),
    );
    const config = ExtractorConfig.prepare({
      configObject: JSON.parse(readFileSync(configPath, "utf8")),
      configObjectFullPath: configPath,
      packageJsonFullPath: join(folder, "package.json"),
    });
    compilerState ??= CompilerState.create(config, {
      additionalEntryPoints: [...entries.values()],
    });
    const result = Extractor.invoke(config, {
      compilerState,
      localBuild: update,
      showVerboseMessages: false,
    });
    if (!result.succeeded)
      throw new Error(`Public API report failed: ${manifest.name}${entry}`);
  }
  if (directory === widget) {
    const budgets = {
      ".": 480 * 1024,
      "./frame": 440 * 1024,
      "./host-composition": 350 * 1024,
      "./providers/para": 65 * 1024,
      "./providers/privy": 65 * 1024,
    };
    const importPath = (entry) =>
      typeof entry === "string"
        ? entry
        : typeof entry?.import === "string"
          ? entry.import
          : entry?.import?.default;
    for (const [entry, budget] of Object.entries(budgets)) {
      const location = importPath(manifest.exports[entry]);
      if (!location) continue;
      const visited = new Set();
      const externals = new Set();
      let gzipBytes = 0;
      function visit(file) {
        if (visited.has(file)) return;
        visited.add(file);
        const source = readFileSync(file);
        gzipBytes += gzipSync(source).length;
        for (const match of source
          .toString()
          .matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
          if (match[1].startsWith(".")) visit(resolve(dirname(file), match[1]));
          else externals.add(match[1]);
        }
      }
      visit(join(folder, location));
      assert.ok(
        gzipBytes <= budget,
        `${manifest.name}${entry} has ${gzipBytes} gzip bytes; budget ${budget}`,
      );
      if (
        [".", "./frame", "./host-composition"].includes(entry)
      ) {
        assert.equal(
          [...externals].some((name) => /^@(privy-io|getpara)\//.test(name)),
          false,
          `Default ${entry} statically imports an optional wallet SDK`,
        );
      }
      console.log(
        `${manifest.name}${entry}: ${gzipBytes} gzip bytes (budget ${budget})`,
      );
    }
  }
  execFileSync("corepack", ["pnpm", "exec", "publint", folder], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync(
    "corepack",
    ["pnpm", "exec", "attw", "--pack", folder, "--profile", "esm-only"],
    { cwd: root, stdio: "inherit" },
  );
}
