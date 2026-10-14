import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/marketing/agents/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/agents")({
  head: () => landingHead(metadata),
  component: Page,
});
