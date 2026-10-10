#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const migrationBase = "9ab669efcfa9572ef6166e71588ae00d089c55d3";
const root = fileURLToPath(new URL("../", import.meta.url));
const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const propertyName = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteral(node))
    ? node.text
    : undefined;
const property = (object, name) =>
  object.properties.find((node) => propertyName(node.name) === name);
const exported = (node) =>
  node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );

/** Public path, independent of framework-only layout groups and parameter names. */
export function publicPath(path) {
  return (
    "/" +
    path
      .split("/")
      .filter((part) => part && !/^\(.+\)$/.test(part) && !part.startsWith("_"))
      .map((part) => {
        if (/^\[\[?\.\.\./.test(part) || part === "$") return "*";
        if (/^\[.+\]$/.test(part) || part.startsWith("$")) return ":param";
        return part;
      })
      .join("/")
  );
}

/** Export declarations and destructuring are both public Next HTTP bindings. */
export function nextMethods(source, filename = "route.ts") {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Set();
  const add = (name) => {
    if (methods.has(name)) found.add(name);
  };
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      statement.exportClause.elements.forEach((element) =>
        add(element.name.text),
      );
    } else if (exported(statement) && ts.isFunctionDeclaration(statement)) {
      add(statement.name?.text);
    } else if (exported(statement) && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text);
        else if (ts.isObjectBindingPattern(declaration.name))
          declaration.name.elements.forEach((element) =>
            add(propertyName(element.name)),
          );
      }
    }
  }
  return [...found].sort();
}

/** Read real route bindings; nonliteral server handlers fail instead of disappearing. */
export function startRoutes(source, filename = "route.ts") {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const routes = [];
  function containsOutlet(node) {
    if (!node) return false;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      propertyName(node.tagName) === "Outlet"
    )
      return true;
    return Boolean(ts.forEachChild(node, containsOutlet));
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      propertyName(node.expression.expression) === "createFileRoute"
    ) {
      const [path] = node.expression.arguments;
      const [options] = node.arguments;
      if (
        !path ||
        !ts.isStringLiteral(path) ||
        !options ||
        !ts.isObjectLiteralExpression(options)
      )
        throw new Error(
          `${filename}: routes must declare literal paths and options`,
        );
      const server = property(options, "server");
      if (server) {
        if (
          !ts.isPropertyAssignment(server) ||
          !ts.isObjectLiteralExpression(server.initializer)
        )
          throw new Error(
            `${filename}: server configuration must be inspectable`,
          );
        const handlers = property(server.initializer, "handlers");
        if (
          !handlers ||
          !ts.isPropertyAssignment(handlers) ||
          !ts.isObjectLiteralExpression(handlers.initializer)
        )
          throw new Error(
            `${filename}: server.handlers must declare its methods`,
          );
        const names = handlers.initializer.properties.map((handler) =>
          propertyName(handler.name),
        );
        if (names.some((name) => !methods.has(name)))
          throw new Error(`${filename}: uninspectable HTTP handler`);
        routes.push({
          path: publicPath(path.text),
          methods: [...new Set(names)].sort(),
          file: filename,
        });
      } else if (
        !/\/_[^/]+$/.test(path.text) &&
        !containsOutlet(property(options, "component")?.initializer) &&
        ["component", "beforeLoad", "loader"].some((name) =>
          property(options, name),
        )
      ) {
        routes.push({ path: publicPath(path.text), file: filename });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return routes;
}

export function compareRoutes(baseline, candidate) {
  const failures = [];
  for (const route of baseline) {
    const match = candidate.filter(
      (current) =>
        current.path === route.path &&
        Boolean(current.methods) === Boolean(route.methods),
    );
    if (!match.length)
      failures.push(
        `${route.path}: missing ${route.methods ? "HTTP binding" : "page"}`,
      );
    else if (route.methods) {
      if (match.length !== 1)
        failures.push(`${route.path}: duplicate HTTP bindings`);
      if (JSON.stringify(match[0].methods) !== JSON.stringify(route.methods))
        failures.push(
          `${route.path}: expected ${route.methods.join(",")}; received ${match[0].methods.join(",")}`,
        );
    }
  }
  return failures;
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function baselineRoutes(app, base) {
  const prefix = `apps/${app}/src/app/`;
  const paths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", base, "--", prefix],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const routes = paths
    .filter((path) => /\/(?:page\.tsx|route\.ts)$/.test(path))
    .map((path) => {
      const route = {
        path: publicPath(
          path
            .slice(prefix.length)
            .replace(/\/(?:page\.tsx|route\.ts)$/, "")
            .replace(/^(?:page\.tsx|route\.ts)$/, ""),
        ),
        file: path,
      };
      if (path.endsWith("route.ts")) {
        route.methods = nextMethods(
          execFileSync("git", ["show", `${base}:${path}`], {
            cwd: root,
            encoding: "utf8",
          }),
          path,
        );
        if (!route.methods.length)
          throw new Error(
            `${path}: baseline route has no identifiable HTTP methods`,
          );
      }
      return route;
    });
  if (!routes.length)
    throw new Error(`No baseline routes for ${app} at ${base}`);
  return routes;
}

function main() {
  const args = process.argv.slice(2);
  const base = args.includes("--base")
    ? args[args.indexOf("--base") + 1]
    : migrationBase;
  if (!/^[0-9a-f]{40}$/.test(base ?? ""))
    throw new Error("--base must name the immutable Next baseline commit");
  execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: root });
  const apps = args.includes("--app")
    ? [args[args.indexOf("--app") + 1]]
    : ["portal", "build"];
  for (const app of apps) {
    if (!["portal", "build"].includes(app))
      throw new Error("--app must be portal or build");
    const baseline = baselineRoutes(app, base);
    const candidate = files(resolve(root, `apps/${app}/src/routes`))
      .filter((path) => /\.tsx?$/.test(path))
      .flatMap((path) =>
        startRoutes(readFileSync(path, "utf8"), relative(root, path)),
      );
    const failures = compareRoutes(baseline, candidate);
    if (failures.length)
      throw new Error(`${app} route parity failed:\n${failures.join("\n")}`);
    console.log(
      `${app}: preserved ${baseline.filter((route) => !route.methods).length} pages and ${baseline.filter((route) => route.methods).length} HTTP bindings from ${base}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
