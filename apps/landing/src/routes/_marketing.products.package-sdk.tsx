import { createFileRoute } from "@tanstack/react-router";
import Page, {
  metadata,
} from "@/features/products/package-sdk/package-sdk-page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/package-sdk")({
  head: () => landingHead(metadata),
  component: Page,
});
