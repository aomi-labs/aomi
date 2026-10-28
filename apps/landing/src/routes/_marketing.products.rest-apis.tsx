import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/products/rest-apis/rest-apis-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/rest-apis")({
  head: () => landingHead(metadata),
  component: Page,
});
