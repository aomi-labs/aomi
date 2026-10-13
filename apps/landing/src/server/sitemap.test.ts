// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./sitemap";

describe("Landing sitemap", () => {
  it("preserves landing, research and MDX URLs and their crawl metadata", async () => {
    const response = GET();
    const body = await response.text();
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(body).toContain("<loc>https://aomi.dev/</loc>");
    expect(body).toContain(
      "<changefreq>weekly</changefreq>\n<priority>1</priority>",
    );
    expect(body).toContain("<loc>https://aomi.dev/agents/build.md</loc>");
    expect(body).toContain("<loc>https://aomi.dev/research/");
    expect(body).toContain("<loc>https://aomi.dev/examples/</loc>");
    expect(body).toContain("<loc>https://aomi.dev/examples/metamask</loc>");
    expect(body).toContain(
      "<loc>https://aomi.dev/playground/configurator</loc>",
    );
    expect(body).toContain(
      "<changefreq>monthly</changefreq>\n<priority>0.7</priority>",
    );
    expect(body).toMatch(/<lastmod>\d{4}-\d\d-\d\dT[^<]+Z<\/lastmod>/);
    expect(body).not.toContain("/docs/build");
  });
});
