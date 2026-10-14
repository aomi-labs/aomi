import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/products/widget/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/widget")({
  head: () => landingHead(metadata),
  component: Page,
});
