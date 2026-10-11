import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/products/plugin-sdk/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/plugin-sdk")({
  head: () => landingHead(metadata),
  component: Page,
});
