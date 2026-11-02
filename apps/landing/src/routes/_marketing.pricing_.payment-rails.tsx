import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/pricing/payment-rails-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/pricing_/payment-rails")({
  head: () => landingHead(metadata),
  component: Page,
});
