import { createFileRoute } from "@tanstack/react-router";
import Page, { metadata } from "@/screens/embed-playground/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/embed-playground")({
  validateSearch: (search) => ({
    embed: search.embed === true || search.embed === "true",
  }),
  head: () => landingHead(metadata),
  component: function RoutePage() {
    return <Page embed={Route.useSearch().embed} />;
  },
});
