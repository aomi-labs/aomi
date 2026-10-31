import { createFileRoute } from "@tanstack/react-router";
import { examples } from "@/lib/source";
import { docsPage } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/examples/$")({
  loader: async ({ params }) => {
    const data = await docsPage({
      data: { collection: "examples", slug: params._splat?.split("/") ?? [] },
    });
    await examples.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => landingHead(loaderData),
  component: function DocsPageRoute() {
    return examples.useContent(Route.useLoaderData().path, undefined);
  },
});
