import { createFileRoute } from "@tanstack/react-router";
import Page, {
  metadata,
} from "@/screens/marketing/products/agentic-toolings/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/agentic-toolings")({
  head: () => landingHead(metadata),
  component: Page,
});
