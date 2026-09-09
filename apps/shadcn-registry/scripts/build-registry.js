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
const packageManifest = JSON.parse(
  readFileSync(path.resolve(baseDir, "../package.json"), "utf8"),
);

function resolveNpmDependency(name) {
  const version =
    packageManifest.dependencies?.[name] ??
    packageManifest.peerDependencies?.[name];
  if (!version) {
    throw new Error(`Registry dependency ${name} is absent from package.json`);
  }
  if (!version.startsWith("workspace:")) return `${name}@${version}`;

  const workspacePackage = JSON.parse(
    readFileSync(
      path.resolve(
        baseDir,
        "../../../packages",
        name.split("/").at(-1),
        "package.json",
      ),
      "utf8",
    ),
  );
  if (workspacePackage.name !== name) {
    throw new Error(`Registry dependency ${name} has no matching workspace`);
  }
  return `${name}@${workspacePackage.version}`;
}

function resolveFileLocation(filePath) {
  if (filePath.endsWith(".css")) return { type: "registry:style" };
  for (const [prefix, type, alias] of [
    ["components/ui/", "registry:ui", "@ui/"],
    ["components/", "registry:component", "@components/"],
    ["hooks/", "registry:hook", "@hooks/"],
    ["lib/", "registry:lib", "@lib/"],
  ]) {
    if (filePath.startsWith(prefix)) {
      return { type, target: alias + filePath.slice(prefix.length) };
    }
  }
  throw new Error(`Unknown registry file location: ${filePath}`);
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
    return { ...resolveFileLocation(f), path: f, content };
  });
  validateInternalImports(entry, files);
  const dependencies = (entry.dependencies ?? []).map(resolveNpmDependency);
  const registryDependencies = (entry.registryDependencies ?? []).map(
    (dependency) =>
      registry.some((candidate) => candidate.name === dependency)
        ? `${REGISTRY_HOMEPAGE}/r/${dependency}.json`
        : dependency,
  );

  const payload = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: entry.name,
    type: entry.type ?? "registry:component",
    description: entry.description,
    files,
    dependencies,
    registryDependencies,
  };

  const outPath = path.join(distDir, `${entry.name}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  // Return item for registry.json (without content)
  return {
    name: entry.name,
    type: entry.type ?? "registry:component",
    description: entry.description,
    files: files.map(({ type, path: p, target }) => ({
      type,
      path: p,
      target,
    })),
    dependencies,
    registryDependencies,
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
