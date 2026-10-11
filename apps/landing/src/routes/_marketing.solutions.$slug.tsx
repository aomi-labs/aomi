import { solutions } from "@/screens/marketing/site";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page, {
  getPageMetadata,
} from "@/screens/marketing/solutions/[slug]/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/solutions/$slug")({
  beforeLoad: ({ params }) => {
    if (!solutions.some((solution) => solution.slug === params.slug))
      throw notFound();
  },
  head: ({ params }) => landingHead(getPageMetadata(params.slug)),
  component: function RoutePage() {
    return <Page slug={Route.useParams().slug} />;
  },
});
