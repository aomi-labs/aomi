import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/research/research-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/research")({
  head: () => landingHead(metadata),
  component: Page,
});
