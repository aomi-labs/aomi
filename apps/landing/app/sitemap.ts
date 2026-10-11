import type { MetadataRoute } from "next";
import { researchPosts } from "@/lib/research";
import { examples, playground } from "@/lib/source";

const SITE = "https://aomi.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Static high-priority entries: agent surfaces and human landing pages.
  const staticEntries: MetadataRoute.Sitemap = [
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

  const researchEntries: MetadataRoute.Sitemap = researchPosts.map((post) => ({
    url: `${SITE}/research/${post.slug}`,
    lastModified: new Date(post.isoDate),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // Examples and playground content (HTML only — no .md mirrors yet).
  const exampleEntries: MetadataRoute.Sitemap = examples
    .generateParams()
    .map(({ slug = [] }) => ({
      url: `${SITE}/examples/${slug.join("/")}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

  const playgroundEntries: MetadataRoute.Sitemap = playground
    .generateParams()
    .map(({ slug = [] }) => ({
      url: `${SITE}/playground/${slug.join("/")}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

  return [
    ...staticEntries,
    ...researchEntries,
    ...exampleEntries,
    ...playgroundEntries,
  ];
}
