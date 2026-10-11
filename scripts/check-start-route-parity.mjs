#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const migrationBase = "9ab669efcfa9572ef6166e71588ae00d089c55d3";
export const remainingMigrationBase =
  "0f903a53d81e4201f8f3cefbd828fb3940582dfd";
export const landingRollout = {
  base: "6e6a0a225dc384cb24e7d2ff4fc1a2ecbb2a5f49",
  paths: ["/blog"],
};
export const migrationApps = {
  portal: { base: migrationBase, nextRoot: "src/app" },
  build: { base: migrationBase, nextRoot: "src/app" },
  landing: { base: remainingMigrationBase, nextRoot: "app" },
  telegram: { base: remainingMigrationBase, nextRoot: "src/app" },
};
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

function startSegments(path, filename) {
  const parts = path.split("/").filter(Boolean);
  // Route IDs have already lost filename escapes. Retain the source spelling
  // to distinguish literal [_] from pathless/non-nested underscores.
  const local = filename
    .replaceAll("\\", "/")
    .split("/routes/")
    .at(-1)
    .replace(/\.[jt]sx?$/, "");
  const encoded = [];
  let segment = "";
  let bracket = false;
  for (const character of local) {
    if ((character === "." || character === "/") && !bracket) {
      if (segment) encoded.push(segment);
      segment = "";
    } else {
      segment += character;
      if (character === "[") bracket = true;
      if (character === "]") bracket = false;
    }
  }
  if (segment) encoded.push(segment);
  if (encoded.at(-1) === "index") encoded.pop();
  const decode = (value) => value.replace(/\[([^\]]*)\]/g, "$1");
  const aligned =
    encoded.length === parts.length &&
    encoded.every((value, index) => decode(value) === parts[index]);
  if (!aligned && encoded.some((value) => value.includes("[")))
    throw new Error(
      `${filename}: escaped filename does not match its literal route ID`,
    );
  return parts.map((value, index) => {
    const spelling = aligned ? encoded[index] : value;
    return {
      value,
      pathless: value.startsWith("_") && !spelling.startsWith("[_]"),
      group: /^\(.+\)$/.test(value) && !spelling.includes("["),
      nonNested: value.endsWith("_") && !spelling.endsWith("[_]"),
    };
  });
}

/** Start routing syntax differs from the immutable Next path convention. */
export function startPublicPath(path, filename = "route.ts") {
  return (
    "/" +
    startSegments(path, filename)
      .filter((part) => !part.pathless && !part.group)
      .map((part) => {
        const value = part.nonNested ? part.value.slice(0, -1) : part.value;
        if (value === "$") return "*";
        return value.startsWith("$") ? ":param" : value;
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

// Match the router generation convention; prototype bindings in colocated
// tests must never stand in for missing production routes.
export function isStartRouteFile(filename) {
  return (
    /\.[jt]sx?$/.test(filename) && !/\.(test|spec)\.[jt]sx?$/.test(filename)
  );
}

/** Read real route bindings; nonliteral server handlers fail instead of disappearing. */
export function startRoutes(source, filename = "route.ts") {
  if (!isStartRouteFile(filename)) return [];
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
          path: startPublicPath(path.text, filename),
          methods: [...new Set(names)].sort(),
          file: filename,
        });
      } else if (
        (path.text.endsWith("/") ||
          !startSegments(path.text, filename).at(-1)?.pathless) &&
        !containsOutlet(property(options, "component")?.initializer) &&
        ["component", "beforeLoad", "loader"].some((name) =>
          property(options, name),
        )
      ) {
        routes.push({
          path: startPublicPath(path.text, filename),
          file: filename,
        });
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

/** Next private folders contain templates, not reachable pages or handlers. */
export function nextRoutes(app, paths, readSource) {
  const prefix = `apps/${app}/${migrationApps[app].nextRoot}/`;
  return paths
    .filter((path) => {
      if (!path.startsWith(prefix)) return false;
      const parts = path.slice(prefix.length).split("/");
      return (
        !parts.slice(0, -1).some((part) => part.startsWith("_")) &&
        /^(?:page\.tsx|route\.tsx?|robots\.ts|sitemap\.ts)$/.test(parts.at(-1))
      );
    })
    .map((path) => {
      const local = path.slice(prefix.length);
      if (local === "robots.ts" || local === "sitemap.ts")
        return {
          path: local === "robots.ts" ? "/robots.txt" : "/sitemap.xml",
          methods: ["GET"],
          file: path,
        };
      const route = {
        path: publicPath(
          local.replace(/(?:^|\/)(?:page\.tsx|route\.tsx?)$/, ""),
        ),
        file: path,
      };
      if (/\/route\.tsx?$/.test(path)) {
        route.methods = nextMethods(readSource(path), path);
        if (!route.methods.length)
          throw new Error(
            `${path}: baseline route has no identifiable HTTP methods`,
          );
      }
      return route;
    });
}

function baselineRoutes(app, base) {
  const prefix = `apps/${app}/${migrationApps[app].nextRoot}/`;
  const paths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", base, "--", prefix],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const routes = nextRoutes(app, paths, (path) =>
    execFileSync("git", ["show", `${base}:${path}`], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  if (!routes.length)
    throw new Error(`No baseline routes for ${app} at ${base}`);
  return routes;
}

function main() {
  const args = process.argv.slice(2);
  const requestedBase = args.includes("--base")
    ? args[args.indexOf("--base") + 1]
    : undefined;
  if (args.includes("--base") && !/^[0-9a-f]{40}$/.test(requestedBase ?? ""))
    throw new Error("--base must name the immutable Next baseline commit");
  const apps = args.includes("--app")
    ? [args[args.indexOf("--app") + 1]]
    : Object.keys(migrationApps);
  for (const app of apps) {
    if (!Object.hasOwn(migrationApps, app))
      throw new Error("--app must be portal, build, landing or telegram");
    const base = requestedBase ?? migrationApps[app].base;
    execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: root });
    const baseline = baselineRoutes(app, base);
    const candidate = files(resolve(root, `apps/${app}/src/routes`))
      .filter(isStartRouteFile)
      .flatMap((path) =>
        startRoutes(readFileSync(path, "utf8"), relative(root, path)),
      );
    const failures = compareRoutes(baseline, candidate);
    if (app === "landing") {
      const additional = baselineRoutes(app, landingRollout.base).filter(
        (route) => landingRollout.paths.includes(route.path),
      );
      if (additional.length !== landingRollout.paths.length)
        throw new Error(
          "Incoming main's Landing rollout inventory is incomplete",
        );
      failures.push(...compareRoutes(additional, candidate));
    }
    if (failures.length)
      throw new Error(`${app} route parity failed:\n${failures.join("\n")}`);
    console.log(
      `${app}: preserved ${baseline.filter((route) => !route.methods).length} pages and ${baseline.filter((route) => route.methods).length} HTTP bindings from ${base}`,
    );
    if (app === "landing")
      console.log(
        `${app}: also preserved ${landingRollout.paths.join(", ")} from incoming main ${landingRollout.base}`,
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
