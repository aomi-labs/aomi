import type {LandingMetadata as Metadata} from "@/lib/metadata";
import { notFound } from "@tanstack/react-router";
import { DetailPage } from "../../detail-page";
import { productBySlug } from "../../site";



export function getPageMetadata(slug: string): Metadata {
  const page = Object.hasOwn(productBySlug, slug) ? productBySlug[slug] : null;
  return page
    ? {
        title: `${page.title} | Aomi`,
        description: page.summary,
        robots: { index: false, follow: false },
      }
    : { title: "Product not found" };
}

export default function ProductPage({slug}: {slug: string}) {
  const page = Object.hasOwn(productBySlug, slug) ? productBySlug[slug] : null;
  if (!page) throw notFound();
  return <DetailPage page={page} kind="product" />;
}
