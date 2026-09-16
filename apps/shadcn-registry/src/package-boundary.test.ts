// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function externalImports(entry: string): Set<string> {
  const visited = new Set<string>();
  const externals = new Set<string>();

  function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /(?:from\s+|import\s*)["']([^"']+)["']/g,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith(".")) {
        visit(resolve(dirname(path), specifier));
      } else {
        externals.add(specifier);
      }
    }
  }

  visit(resolve(packageRoot, "dist", entry));
  return externals;
}

describe("published widget package boundaries", () => {
  it("ships a self-contained compiled stylesheet", () => {
    const css = readFileSync(
      resolve(packageRoot, "dist", "styles.css"),
      "utf8",
    );

    expect(css).toContain(".flex");
    expect(css).toContain(".h-full");
    expect(css).not.toMatch(/@(apply|source|theme)\b/);
  });

  it("keeps the providerless widget graph free of provider SDKs", () => {
    const imports = externalImports("aomi-widget.js");
    expect([...imports].some((name) => name.startsWith("@getpara/"))).toBe(
      false,
    );
    expect([...imports].some((name) => name.startsWith("@privy-io/"))).toBe(
      false,
    );
  });

  it("keeps provider entrypoints isolated from each other", () => {
    const para = externalImports("providers/para.js");
    const privy = externalImports("providers/privy.js");
    expect([...para].some((name) => name.startsWith("@privy-io/"))).toBe(false);
    expect([...privy].some((name) => name.startsWith("@getpara/"))).toBe(false);
    expect([...para].some((name) => name.startsWith("@getpara/"))).toBe(true);
    expect([...privy].some((name) => name.startsWith("@privy-io/"))).toBe(true);
  });

  it("marks every browser entry as a client module", () => {
    for (const entry of [
      "index.js",
      "aomi-widget.js",
      "providers/para.js",
      "providers/privy.js",
    ]) {
      expect(readFileSync(resolve(packageRoot, "dist", entry), "utf8")).toMatch(
        /^"use client";/,
      );
    }
  });
});
