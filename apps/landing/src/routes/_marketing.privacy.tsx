import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/privacy/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/privacy")({
  head: () => landingHead(metadata),
  component: Page,
});
