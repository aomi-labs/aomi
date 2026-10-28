import { createFileRoute } from "@tanstack/react-router";
import Page, {
  getPageMetadata,
} from "@/features/research/research-article-page";
import { researchArticle } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
// Blog posts share the research post page; only the URL prefix differs.
export const Route = createFileRoute("/_marketing/blog_/$slug")({
  loader: ({ params }) => researchArticle({ data: params.slug }),
  head: ({ params }) => landingHead(getPageMetadata(params.slug)),
  component: function RoutePage() {
    return <Page post={Route.useLoaderData()} />;
  },
});
