// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./registry";

function read(slug: string[]) {
  return GET(new Request("http://localhost/r/registry.json"), slug);
}

describe("Landing registry", () => {
  it("serves bundled registry JSON with the existing cache contract", async () => {
    const response = await read(["registry.json"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    );
    expect(await response.json()).toMatchObject({ items: expect.any(Array) });
  });

  it.each([
    { slug: [] },
    { slug: ["missing.json"] },
    { slug: ["../content/agents/agents.md"] },
    { slug: ["..", "registry.json"] },
    { slug: ["registry.json/.."] },
    { slug: ["registry.json\\.."] },
    { slug: ["registry.md"] },
  ])(
    "does not expose missing or non-registry files ($slug)",
    async ({ slug }) => {
      const response = await read(slug);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    },
  );
});
