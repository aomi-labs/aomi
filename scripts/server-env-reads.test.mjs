// @vitest-environment node
// Guardrail for AGENTS.md "Secrets and env vars": server code reads the server
// name of a var only. A NEXT_PUBLIC_ read on the server is the alias-fallback
// shape that let one value live under two names in two stores.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function* sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "bff-tests")
        yield* sources(path);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      yield path;
    }
  }
}

describe("server env reads", () => {
  it("never read a NEXT_PUBLIC_ var in server-only code", () => {
    const offenders = [];
    for (const directory of [
      "packages/account/src",
      "apps/portal/src/server",
      "apps/build/src/server",
      "apps/edge/src",
      "apps/landing/app/api",
    ]) {
      for (const file of sources(join(root, directory))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (/env(\.|\[["'])NEXT_PUBLIC_/.test(line))
              offenders.push(`${relative(root, file)}:${index + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
