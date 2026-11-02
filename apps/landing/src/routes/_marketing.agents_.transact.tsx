import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/features/agents/agents-transact-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/agents_/transact")({
  head: () => landingHead(metadata),
  component: Page,
});
