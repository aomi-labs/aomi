import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/products/widget/widget-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/widget")({
  head: () => landingHead(metadata),
  component: Page,
});
