import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SDK README", () => {
  it("keeps every TypeScript block in the typechecked snippets", () => {
    const readme = readFileSync(
      new URL("../../../packages/client/README.md", import.meta.url),
      "utf8",
    );
    const snippets = readFileSync(
      new URL("./readme-snippets.ts", import.meta.url),
      "utf8",
    );
    const blocks = [...readme.matchAll(/```ts\n(.*?)\n```/gs)].map(
      (match) => match[1],
    );
    expect(snippets.split("\n").slice(1).join("\n")).toBe(
      blocks.join("\n\n") + "\n",
    );
  });
});
