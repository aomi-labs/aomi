#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const ALLOWED_PORTAL_WIDGET_IMPORTS = new Map([
  ["@aomi-labs/widget-lib", "index.ts"],
  ["@aomi-labs/widget-lib/host-composition", "host-composition.ts"],
  [
    "@aomi-labs/widget-lib/providers/para",
    "lib/wallet-kit/providers/para/index.ts",
  ],
  [
    "@aomi-labs/widget-lib/providers/privy",
    "lib/wallet-kit/providers/privy/index.ts",
  ],
]);

function isTestFile(path) {
  return (
    path.includes(`${sep}__tests__${sep}`) ||
    /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)
  );
}

function sourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!new Set(["dist", "node_modules"]).has(entry.name)) visit(path);
      } else if (
        SOURCE_EXTENSIONS.has(extname(entry.name)) &&
        !isTestFile(path)
      ) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort();
}

function moduleSpecifiers(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  const add = (node) => {
    if (ts.isStringLiteralLike(node)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      imports.push({ line: line + 1, specifier: node.text });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function isInside(path, directory) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

function tsconfigAliases(path) {
  if (!existsSync(path)) return [];
  const config = JSON.parse(readFileSync(path, "utf8"));
  const compilerOptions = config.compilerOptions ?? {};
  const base = resolve(dirname(path), compilerOptions.baseUrl ?? ".");
  return Object.entries(compilerOptions.paths ?? {}).map(
    ([pattern, targets]) => ({
      pattern,
      targets: targets.map((target) => resolve(base, target)),
    }),
  );
}

function aliasDestinations(specifier, aliases) {
  const exact = aliases.find(
    ({ pattern }) => !pattern.includes("*") && specifier === pattern,
  );
  if (exact) return exact.targets;

  const matches = [];
  for (const { pattern, targets } of aliases) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) continue;
    const prefix = pattern.slice(0, wildcard);
    const suffix = pattern.slice(wildcard + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const matched = specifier.slice(
      prefix.length,
      specifier.length - suffix.length,
    );
    matches.push({
      prefixLength: prefix.length,
      suffixLength: suffix.length,
      targets: targets.map((target) => target.replaceAll("*", matched)),
    });
  }
  matches.sort(
    (left, right) =>
      right.prefixLength - left.prefixLength ||
      right.suffixLength - left.suffixLength,
  );
  return matches[0]?.targets ?? [];
}

function importDestinations(specifier, importer, aliases) {
  if (specifier.startsWith(".")) {
    return [resolve(dirname(importer), specifier)];
  }
  return aliasDestinations(specifier, aliases);
}

function inspectTree(root, check) {
  const violations = [];
  for (const path of sourceFiles(root)) {
    for (const imported of moduleSpecifiers(path)) {
      const reason = check(imported.specifier, path);
      if (reason) violations.push({ path, ...imported, reason });
    }
  }
  return violations;
}

export function checkFrontendBoundaries(root = SCRIPT_ROOT) {
  const portalRoot = resolve(root, "apps/portal");
  const portalSource = resolve(portalRoot, "src");
  const widgetSource = resolve(root, "apps/shadcn-registry/src");
  const packagesRoot = resolve(root, "packages");
  const appsRoot = resolve(root, "apps");
  const clientSource = resolve(packagesRoot, "client/src");
  const reactSource = resolve(packagesRoot, "react/src");
  const portalAliases = tsconfigAliases(resolve(portalRoot, "tsconfig.json"));
  const widgetAliases = tsconfigAliases(
    resolve(root, "apps/shadcn-registry/tsconfig.json"),
  );
  const packageProjects = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageRoot = resolve(packagesRoot, entry.name);
      return {
        root: packageRoot,
        aliases: tsconfigAliases(resolve(packageRoot, "tsconfig.json")),
      };
    });

  const packageAliasesFor = (importer) =>
    packageProjects.find(({ root: packageRoot }) =>
      isInside(importer, packageRoot),
    )?.aliases ?? [];

  const violations = [
    ...inspectTree(portalSource, (specifier, importer) => {
      const destinations = importDestinations(
        specifier,
        importer,
        portalAliases,
      );
      const widgetDestinations = destinations.filter((destination) =>
        isInside(destination, widgetSource),
      );
      const approvedTarget = ALLOWED_PORTAL_WIDGET_IMPORTS.get(specifier);
      if (
        specifier.includes("shadcn-registry") ||
        /^@\/(?:components|hooks|lib)(?:\/|$)/.test(specifier) ||
        (widgetDestinations.length > 0 &&
          (!approvedTarget ||
            widgetDestinations.some(
              (destination) =>
                destination !== resolve(widgetSource, approvedTarget),
            )))
      ) {
        return "Portal must consume widget-owned UI through a package entrypoint";
      }
      if (
        specifier.startsWith("@aomi-labs/widget-lib/") &&
        !ALLOWED_PORTAL_WIDGET_IMPORTS.has(specifier)
      ) {
        return "Portal may use only the declared widget host/provider entrypoints";
      }
      return null;
    }),
    ...inspectTree(widgetSource, (specifier, importer) => {
      const destinations = importDestinations(
        specifier,
        importer,
        widgetAliases,
      );
      if (
        specifier.startsWith("@portal/") ||
        destinations.some((destination) => isInside(destination, portalSource))
      ) {
        return "the shared widget implementation cannot depend on Portal";
      }
      return null;
    }),
    ...inspectTree(packagesRoot, (specifier, importer) => {
      const destinations = importDestinations(
        specifier,
        importer,
        packageAliasesFor(importer),
      );
      if (
        isInside(importer, clientSource) &&
        (specifier.startsWith("@aomi-labs/react") ||
          destinations.some((destination) =>
            isInside(destination, reactSource),
          ))
      ) {
        return "the SDK cannot depend on the React runtime";
      }
      if (
        isInside(importer, reactSource) &&
        (specifier.startsWith("@aomi-labs/widget-lib") ||
          destinations.some((destination) =>
            isInside(destination, widgetSource),
          ))
      ) {
        return "the React runtime cannot depend on widget UI";
      }
      if (
        specifier.startsWith("@portal/") ||
        specifier.startsWith("@aomi-labs/widget-lib") ||
        destinations.some((destination) => isInside(destination, appsRoot))
      ) {
        return "workspace packages cannot depend on app-owned UI";
      }
      return null;
    }),
  ];

  const portalConfig = JSON.parse(
    readFileSync(resolve(portalRoot, "tsconfig.json"), "utf8"),
  );
  const paths = portalConfig.compilerOptions?.paths ?? {};
  for (const alias of Object.keys(paths)) {
    if (alias === "@aomi-labs/widget-lib/*") {
      violations.push({
        path: resolve(portalRoot, "tsconfig.json"),
        line: 1,
        specifier: alias,
        reason: "wildcard widget aliases bypass package exports",
      });
    }
  }
  if (!("@aomi-labs/widget-lib/host-composition" in paths)) {
    violations.push({
      path: resolve(portalRoot, "tsconfig.json"),
      line: 1,
      specifier: "@aomi-labs/widget-lib/host-composition",
      reason: "Portal must resolve the declared host-composition entrypoint",
    });
  }

  const widgetManifest = JSON.parse(
    readFileSync(resolve(root, "apps/shadcn-registry/package.json"), "utf8"),
  );
  if (!widgetManifest.exports?.["./host-composition"]) {
    violations.push({
      path: resolve(root, "apps/shadcn-registry/package.json"),
      line: 1,
      specifier: "./host-composition",
      reason: "the widget package must publish the host-composition contract",
    });
  }

  return violations;
}

export function formatViolations(violations, root = SCRIPT_ROOT) {
  return violations
    .map(
      ({ path, line, specifier, reason }) =>
        `${relative(root, path)}:${line}: ${reason}: ${specifier}`,
    )
    .join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = checkFrontendBoundaries();
  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exitCode = 1;
  } else {
    console.log("Frontend dependency boundaries are intact.");
  }
}
