import { createFileRoute } from "@tanstack/react-router";
import Page, {
  getPageMetadata,
} from "@/features/research/research-article-page";
import { researchArticle } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/research_/$slug")({
  loader: ({ params }) => researchArticle({ data: params.slug }),
  head: ({ params }) => landingHead(getPageMetadata(params.slug)),
  component: function RoutePage() {
    return <Page post={Route.useLoaderData()} />;
  },
});
