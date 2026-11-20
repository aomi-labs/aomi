import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import typescript from "typescript";
import { describe, expect, it } from "vitest";

// D18: people never read toolset, plugin, namespace or orchestrator-core. A
// person installs packages; "skill" names a package's instructions file, so
// only Build, where authors edit those files, may say it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED = /\b(?:toolsets?|plugins?|namespaces?|orchestrator-core)\b/i;
const PERSON =
  /\b(?:toolsets?|plugins?|namespaces?|orchestrator-core|skills?)\b/i;
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** `file: text` for each capitalized string in a surface's compiled code (JSX
 * text compiles to string literals) that names one of `words`. */
function named(dir, words) {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|stories|typecheck)\.|\.d\.ts$/.test(entry.name),
    )
    .flatMap((entry) => {
      const file = join(entry.parentPath, entry.name);
      const js = typescript.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          jsx: typescript.JsxEmit.ReactJSX,
          target: typescript.ScriptTarget.ES2022,
          removeComments: true,
        },
      }).outputText;
      return [...js.matchAll(LITERAL)]
        .map((match) => match[1] ?? match[2])
        .filter((text) => /^[A-Z]/.test(text) && words.test(text))
        .map((text) => `${file.slice(root.length + 1)}: ${text}`);
    });
}

describe("retired words", () => {
  it.each([
    ["Portal and Library", "packages/widget/src", PERSON],
    ["Portal", "apps/portal/src", PERSON],
    ["Build", "apps/build/src", RETIRED],
  ])("%s copy names none", (_, dir, words) => {
    expect(named(dir, words)).toEqual([]);
  });
});
