import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registry } from "../src/registry.js";

const REGISTRY_NAME = "aomi";
const REGISTRY_HOMEPAGE = "https://aomi.dev";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css"];
const IMPORT_EXPORT_RE =
  /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(baseDir, "../dist");
const srcDir = path.resolve(baseDir, "../src");

function resolveFileType(filePath) {
  if (filePath.endsWith(".css")) return "registry:style";
  if (filePath.includes("/hooks/")) return "registry:hook";
  if (filePath.includes("/lib/")) return "registry:lib";
  return "registry:component";
}

function fileExists(registryFilePath) {
  try {
    readFileSync(path.join(srcDir, registryFilePath), "utf8");
    return true;
  } catch {
    return false;
  }
}

function resolveRelativeImport(fromFilePath, specifier) {
  if (!specifier.startsWith(".")) return null;

  const basePath = path
    .join(path.dirname(fromFilePath), specifier)
    .replaceAll(path.sep, "/");
  const candidates = [];

  if (path.extname(basePath)) {
    candidates.push(basePath);
  }
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(
      path.join(basePath, `index${extension}`).replaceAll(path.sep, "/"),
    );
  }

  return candidates.find(fileExists) ?? null;
}

function registryDependencyName(dependency) {
  if (!dependency.startsWith("http")) return dependency;
  return path.basename(dependency, ".json");
}

function collectAvailablePaths(entry, seen = new Set()) {
  if (seen.has(entry.name)) return [];
  seen.add(entry.name);

  const filePaths = Array.isArray(entry.file) ? entry.file : [entry.file];
  const dependencyPaths = (entry.registryDependencies ?? []).flatMap(
    (dependency) => {
      const dependencyEntry = registry.find(
        (candidate) => candidate.name === registryDependencyName(dependency),
      );
      return dependencyEntry
        ? collectAvailablePaths(dependencyEntry, seen)
        : [];
    },
  );

  return [...filePaths, ...dependencyPaths];
}

function validateInternalImports(entry, files) {
  const includedPaths = new Set(collectAvailablePaths(entry));
  const missing = [];

  for (const file of files) {
    IMPORT_EXPORT_RE.lastIndex = 0;
    for (const match of file.content.matchAll(IMPORT_EXPORT_RE)) {
      const resolved = resolveRelativeImport(file.path, match[1]);
      if (resolved && !includedPaths.has(resolved)) {
        missing.push(`${file.path} -> ${match[1]} (${resolved})`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      [
        `Registry item "${entry.name}" is missing internal files:`,
        ...missing.map((item) => `  - ${item}`),
      ].join("\n"),
    );
  }
}

function buildComponent(entry) {
  // Support single file (string) or multiple files (array)
  const filePaths = Array.isArray(entry.file) ? entry.file : [entry.file];

  const files = filePaths.map((f) => {
    const content = readFileSync(path.join(srcDir, f), "utf8");
    return { type: resolveFileType(f), path: f, content };
  });
  validateInternalImports(entry, files);

  const payload = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: entry.name,
    type: entry.type ?? "registry:component",
    description: entry.description,
    files,
    dependencies: entry.dependencies ?? [],
    registryDependencies: entry.registryDependencies ?? [],
  };

  const outPath = path.join(distDir, `${entry.name}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  // Return item for registry.json (without content)
  return {
    name: entry.name,
    type: entry.type ?? "registry:component",
    description: entry.description,
    files: files.map(({ type, path: p }) => ({ type, path: p })),
    dependencies: entry.dependencies ?? [],
    registryDependencies: entry.registryDependencies ?? [],
  };
}

function main() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const items = registry.map(buildComponent);

  // Generate registry.json index
  const registryIndex = {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: REGISTRY_NAME,
    homepage: REGISTRY_HOMEPAGE,
    items,
  };

  writeFileSync(
    path.join(distDir, "registry.json"),
    JSON.stringify(registryIndex, null, 2),
  );

  console.log(`Wrote ${items.length} component files + registry.json to dist/`);
}

main();
