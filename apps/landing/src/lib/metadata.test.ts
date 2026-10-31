import { describe, expect, it } from "vitest";
import { landingHead } from "./metadata";
describe("Landing SEO metadata", () => {
  it("keeps default site and absolute sharing-image metadata", () => {
    expect(landingHead().meta).toContainEqual({
      property: "og:image",
      content: "https://aomi.dev/api/og",
    });
    expect(landingHead().meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });
  it("keeps noindex and markdown alternate links on agent pages", () => {
    const result = landingHead({
      title: "Agent",
      robots: { index: false, follow: false },
      alternates: { types: { "text/markdown": "/agents.md" } },
      twitter: { title: "Agent" },
    });
    expect(result.meta).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:card",
      content: "summary",
    });
    expect(result.links).toContainEqual({
      rel: "alternate",
      type: "text/markdown",
      href: "https://aomi.dev/agents.md",
    });
  });
  it("replaces parent OpenGraph fields for articles and emits their publication date", () => {
    const result = landingHead({
      openGraph: {
        title: "Research",
        type: "article",
        url: "/research/article",
        publishedTime: "2026-09-18",
      },
    });
    expect(result.meta).toContainEqual({
      property: "article:published_time",
      content: "2026-09-18",
    });
    expect(result.meta).toContainEqual({
      property: "og:url",
      content: "https://aomi.dev/research/article",
    });
    expect(
      result.meta.filter(
        (meta) => "property" in meta && meta.property === "og:image",
      ),
    ).toEqual([]);
  });
});
