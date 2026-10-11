import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/about/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/about")({
  head: () => landingHead(metadata),
  component: Page,
});
