import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/products/rest-apis/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/rest-apis")({
  head: () => landingHead(metadata),
  component: Page,
});
