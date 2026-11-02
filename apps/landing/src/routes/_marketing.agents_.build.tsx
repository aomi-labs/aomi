import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/agents/agents-build-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/agents_/build")({
  head: () => landingHead(metadata),
  component: Page,
});
