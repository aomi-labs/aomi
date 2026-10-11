import { productBySlug } from "@/screens/marketing/site";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page, {
  getPageMetadata,
} from "@/screens/marketing/products/[slug]/page";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/_marketing/products/$slug")({
  beforeLoad: ({ params }) => {
    if (!Object.hasOwn(productBySlug, params.slug)) throw notFound();
  },
  head: ({ params }) => landingHead(getPageMetadata(params.slug)),
  component: function RoutePage() {
    return <Page slug={Route.useParams().slug} />;
  },
});
