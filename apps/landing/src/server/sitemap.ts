import "@tanstack/react-start/server-only";
import { blogPosts, researchPosts } from "@/lib/research";
import { contentUrls } from "./sitemap-content";

const SITE = "https://aomi.dev";

type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "weekly" | "monthly";
  priority: number;
};

function sitemap(): SitemapEntry[] {
  const now = new Date();

  // Static high-priority entries: agent surfaces and human landing pages.
  const staticEntries: SitemapEntry[] = [
    {
      url: `${SITE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE}/agents`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/agents.md`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/faq.md`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE}/agents/build`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/agents/build.md`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/agents/transact`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/agents/transact.md`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/research`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE}/llms.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/llms-full.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE}/playground`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  // Docs live on Mintlify (proxied at /docs) and publish their own sitemap
  // at /docs/sitemap.xml — see robots.ts.

  const researchEntries: SitemapEntry[] = researchPosts.map((post) => ({
    url: `${SITE}/research/${post.slug}`,
    lastModified: new Date(post.isoDate),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const blogEntries: SitemapEntry[] = blogPosts.map((post) => ({
    url: `${SITE}/blog/${post.slug}`,
    lastModified: new Date(post.isoDate),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // Examples and playground content (HTML only — no .md mirrors yet).
  const exampleEntries: SitemapEntry[] = contentUrls("examples").map((url) => ({
    url: `${SITE}${url}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const playgroundEntries: SitemapEntry[] = contentUrls("playground").map(
    (url) => ({
      url: `${SITE}${url}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }),
  );

  return [
    ...staticEntries,
    ...researchEntries,
    ...blogEntries,
    ...exampleEntries,
    ...playgroundEntries,
  ];
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

export function GET() {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemap()
      .map(
        (entry) =>
          `<url>\n<loc>${escapeXml(entry.url)}</loc>\n` +
          `<lastmod>${entry.lastModified.toISOString()}</lastmod>\n` +
          `<changefreq>${entry.changeFrequency}</changefreq>\n` +
          `<priority>${entry.priority}</priority>\n</url>\n`,
      )
      .join("") +
    "</urlset>\n";
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
