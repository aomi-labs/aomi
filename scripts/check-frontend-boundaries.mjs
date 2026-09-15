#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
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
const ALLOWED_PORTAL_WIDGET_IMPORTS = new Set([
  "@aomi-labs/widget-lib",
  "@aomi-labs/widget-lib/host-composition",
  "@aomi-labs/widget-lib/providers/para",
  "@aomi-labs/widget-lib/providers/privy",
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

function resolvesInside(specifier, importer, directory) {
  return (
    specifier.startsWith(".") &&
    resolve(dirname(importer), specifier).startsWith(`${directory}${sep}`)
  );
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
  const clientSource = resolve(packagesRoot, "client/src");
  const reactSource = resolve(packagesRoot, "react/src");

  const violations = [
    ...inspectTree(portalSource, (specifier) => {
      if (
        specifier.includes("shadcn-registry") ||
        /^@\/(?:components|hooks|lib)(?:\/|$)/.test(specifier)
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
      if (
        specifier.startsWith("@portal/") ||
        resolvesInside(specifier, importer, portalSource)
      ) {
        return "the shared widget implementation cannot depend on Portal";
      }
      return null;
    }),
    ...inspectTree(packagesRoot, (specifier, importer) => {
      if (
        importer.startsWith(`${clientSource}${sep}`) &&
        specifier.startsWith("@aomi-labs/react")
      ) {
        return "the SDK cannot depend on the React runtime";
      }
      if (
        importer.startsWith(`${reactSource}${sep}`) &&
        specifier.startsWith("@aomi-labs/widget-lib")
      ) {
        return "the React runtime cannot depend on widget UI";
      }
      if (
        specifier.startsWith("@portal/") ||
        specifier.startsWith("@aomi-labs/widget-lib") ||
        resolvesInside(specifier, importer, resolve(root, "apps"))
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
