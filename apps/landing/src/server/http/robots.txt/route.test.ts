// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("Landing robots", () => {
  it("preserves crawler access, the API exclusion and both sitemap locations", async () => {
    const response = GET();
    const body = await response.text();
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(body).toContain("User-Agent: GPTBot\nAllow: /\n\n");
    expect(body).toContain("User-Agent: ClaudeBot\nAllow: /\n\n");
    expect(body).toContain("User-Agent: *\nAllow: /\nDisallow: /api/\n\n");
    expect(body).toContain("Host: https://aomi.dev\n");
    expect(body).toContain("Sitemap: https://aomi.dev/sitemap.xml\n");
    expect(body).toContain("Sitemap: https://aomi.dev/docs/sitemap.xml\n");
  });
});
