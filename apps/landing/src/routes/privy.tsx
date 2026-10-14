import { createFileRoute } from "@tanstack/react-router";
import Page from "@/screens/privy/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/privy")({
  ssr: false,
  head: () => landingHead(),
  component: Page,
});
