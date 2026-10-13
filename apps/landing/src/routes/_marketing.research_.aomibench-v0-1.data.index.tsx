import { createFileRoute } from "@tanstack/react-router";
import Page, {
  metadata,
} from "@/features/research/aomibench-data-page";
import { researchDirectory } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute(
  "/_marketing/research_/aomibench-v0-1/data/",
)({
  loader: ({ params }) => researchDirectory({ data: [] }),
  head: () => landingHead(metadata),
  component: function RoutePage() {
    return <Page {...Route.useLoaderData()} />;
  },
});
