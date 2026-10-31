export type LandingMetadata = {
  title?: string;
  description?: string | null;
  icons?: { icon: string };
  metadataBase?: URL;
  robots?: { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    locale?: string;
    type?: string;
    publishedTime?: string;
    images?: Array<
      string | { url: string; width?: number; height?: number; alt?: string }
    >;
  };
  twitter?: {
    title?: string;
    description?: string;
    card?: string;
    creator?: string;
    images?: string[];
  };
  alternates?: { canonical?: string; types?: Record<string, string> };
};

export const rootMetadata: LandingMetadata = {
  title: "Best Blockchain Harness for Agentic AI | Aomi",
  description:
    "Blockchain AI infrastructure for Web3 builders and enterprise. Embed AI features with our React SDK, transact with Skills. Universal Smart Contract support, human-in-the-loop, multi-chain. Ship in minutes.",
  icons: {
    icon: "/assets/images/bubble.svg",
  },
  metadataBase: new URL("https://aomi.dev"),
  openGraph: {
    title: "Best Blockchain Harness for Agentic AI | Aomi",
    description:
      "Blockchain AI infrastructure for Web3 builders and enterprise. Embed AI features with our React SDK, transact with Skills. Universal Smart Contract support, human-in-the-loop, multi-chain.",
    url: "https://aomi.dev",
    siteName: "Aomi",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "Aomi - Best Blockchain Harness for Agentic AI",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Blockchain Harness for Agentic AI | Aomi",
    description:
      "Blockchain AI infrastructure for Web3 builders and enterprise. Embed AI features with our React SDK, transact with Skills. Universal Smart Contract support, human-in-the-loop, multi-chain.",
    images: ["/api/og"],
    creator: "@aomi_labs",
  },
};

type Meta =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };
export function landingHead(page: LandingMetadata = {}) {
  const metadata = { ...rootMetadata, ...page };
  const meta: Meta[] = [];
  const links: Array<{ rel: string; href: string; type?: string }> = [];
  const absolute = (url: string) => new URL(url, metadata.metadataBase).href;
  if (metadata.title) meta.push({ title: metadata.title });
  if (metadata.description)
    meta.push({ name: "description", content: metadata.description });
  if (metadata.robots) {
    const directives = Object.entries(metadata.robots).map(([key, enabled]) =>
      enabled ? key : `no${key}`,
    );
    meta.push({ name: "robots", content: directives.join(", ") });
  }
  const og = metadata.openGraph;
  if (og) {
    for (const [key, value] of Object.entries(og)) {
      if (typeof value !== "string") continue;
      const property =
        key === "publishedTime"
          ? "article:published_time"
          : `og:${key === "siteName" ? "site_name" : key}`;
      meta.push({ property, content: key === "url" ? absolute(value) : value });
    }
    for (const image of og.images ?? []) {
      const item = typeof image === "string" ? { url: image } : image;
      meta.push({ property: "og:image", content: absolute(item.url) });
      for (const key of ["width", "height", "alt"] as const)
        if (item[key] !== undefined)
          meta.push({
            property: `og:image:${key}`,
            content: String(item[key]),
          });
    }
  }
  const twitter = metadata.twitter
    ? {
        card: metadata.twitter.images?.length
          ? "summary_large_image"
          : "summary",
        ...metadata.twitter,
      }
    : undefined;
  for (const [key, value] of Object.entries(twitter ?? {})) {
    if (typeof value === "string")
      meta.push({ name: `twitter:${key}`, content: value });
    if (key === "images" && Array.isArray(value))
      for (const image of value)
        meta.push({ name: "twitter:image", content: absolute(image) });
  }
  if (metadata.alternates?.canonical)
    links.push({
      rel: "canonical",
      href: absolute(metadata.alternates.canonical),
    });
  for (const [type, href] of Object.entries(metadata.alternates?.types ?? {}))
    links.push({ rel: "alternate", type, href: absolute(href) });
  return { meta, links };
}
