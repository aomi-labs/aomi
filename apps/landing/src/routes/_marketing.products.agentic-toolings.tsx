import { createFileRoute } from "@tanstack/react-router";
import Page, {
  metadata,
} from "@/features/products/agentic-toolings/agentic-toolings-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/agentic-toolings")({
  head: () => landingHead(metadata),
  component: Page,
});
