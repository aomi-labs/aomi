import { createFileRoute } from "@tanstack/react-router";
import Page, {
  metadata,
} from "@/screens/marketing/research/aomibench-v0-1/data/[[...path]]/page";
import { researchDirectory } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute(
  "/_marketing/research_/aomibench-v0-1/data/$",
)({
  loader: ({ params }) =>
    researchDirectory({ data: params._splat?.split("/") ?? [] }),
  head: () => landingHead(metadata),
  component: function RoutePage() {
    return <Page {...Route.useLoaderData()} />;
  },
});
