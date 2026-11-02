import { createFileRoute } from "@tanstack/react-router";
import { playground } from "@/lib/source";
import { docsPage } from "@/server-functions";
import { landingHead } from "@/lib/metadata";
export const Route = createFileRoute("/playground/$")({
  loader: async ({ params }) => {
    const data = await docsPage({
      data: { collection: "playground", slug: params._splat?.split("/") ?? [] },
    });
    await playground.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => landingHead(loaderData),
  component: function DocsPageRoute() {
    return playground.useContent(Route.useLoaderData().path, undefined);
  },
});
