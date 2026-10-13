import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/blog/blog-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/blog")({
  head: () => landingHead(metadata),
  component: Page,
});
