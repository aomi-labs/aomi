// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

// Deprecated subpaths stay importable until 4.0. Instead of an API report per
// subpath, check that each still resolves and still exports every name it did.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
) as { exports: Record<string, { types: string; import: string }> };
const previous = JSON.parse(
  readFileSync(resolve(packageRoot, "src/compat-exports.json"), "utf8"),
) as Record<string, string[]>;

const declarations = Object.keys(previous).map((entry) =>
  resolve(packageRoot, manifest.exports[`./${entry}`]!.types),
);
const program = ts.createProgram(declarations, {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

it.each(Object.entries(previous))(
  "keeps ./%s resolvable with its previous exports",
  (entry, names) => {
    const target = manifest.exports[`./${entry}`]!;
    expect(existsSync(resolve(packageRoot, target.import))).toBe(true);
    const source = program.getSourceFile(resolve(packageRoot, target.types))!;
    const symbol = checker.getSymbolAtLocation(source)!;
    const exported = checker
      .getExportsOfModule(symbol)
      .map((candidate) => candidate.name);
    expect(exported).toEqual(expect.arrayContaining(names));
  },
);
