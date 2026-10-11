import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/news/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/news")({
  head: () => landingHead(metadata),
  component: Page,
});
