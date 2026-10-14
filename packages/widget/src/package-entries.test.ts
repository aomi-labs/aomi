// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// package-entries.json is the one list of entry points: tsup and the type
// build read it, and both published manifests must match it.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) =>
  JSON.parse(readFileSync(resolve(packageRoot, path), "utf8"));
const { entries, deprecated } = read("package-entries.json") as Record<
  "entries" | "deprecated",
  Record<string, string>
>;
const stylesheets = {
  "./styles.css": {
    types: "./dist/styles.d.ts",
    default: "./dist/styles.css",
  },
  // Deprecated raw Tailwind source; styles.css carries the same tokens scoped.
  "./themes/*.css": "./src/themes/*.css",
};
const expectedExports = Object.fromEntries([
  ...Object.keys({ ...entries, ...deprecated }).map((entry) => [
    entry === "index" ? "." : `./${entry}`,
    { types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js` },
  ]),
  ...Object.entries(stylesheets),
]);

describe("package entry points", () => {
  it("maps every entry to an existing source module", () => {
    for (const source of Object.values({ ...entries, ...deprecated }))
      expect(existsSync(resolve(packageRoot, source)), source).toBe(true);
  });

  it("publishes exactly the listed entries from @aomi-labs/widget", () => {
    expect(read("package.json").exports).toEqual(expectedExports);
  });

  it("forwards the same entries from the deprecated @aomi-labs/widget-lib", () => {
    expect(Object.keys(read("../widget-lib/package.json").exports)).toEqual(
      Object.keys(expectedExports),
    );
  });

  it("records the previous exports of every deprecated entry", () => {
    expect(Object.keys(read("src/compat-exports.json")).sort()).toEqual(
      Object.keys(deprecated).sort(),
    );
  });
});
