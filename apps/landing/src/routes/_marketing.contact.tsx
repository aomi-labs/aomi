import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/contact/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/contact")({
  head: () => landingHead(metadata),
  component: Page,
});
