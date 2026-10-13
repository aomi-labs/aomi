import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/marketing/terms-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/terms")({
  head: () => landingHead(metadata),
  component: Page,
});
