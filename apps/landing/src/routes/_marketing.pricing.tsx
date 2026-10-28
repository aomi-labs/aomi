import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/pricing/pricing-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/pricing")({
  head: () => landingHead(metadata),
  component: Page,
});
