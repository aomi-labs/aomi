import { useFumadocsLoader } from "fumadocs-core/source/client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import Layout from "@/features/examples/examples-layout";
import { docsTree } from "@/server-functions";
export const Route = createFileRoute("/examples")({
  loader: () => docsTree({ data: "examples" }),
  component: function DocsLayoutRoute() {
    const { pageTree } = useFumadocsLoader({ pageTree: Route.useLoaderData() });
    return (
      <Layout tree={pageTree}>
        <Outlet />
      </Layout>
    );
  },
});
