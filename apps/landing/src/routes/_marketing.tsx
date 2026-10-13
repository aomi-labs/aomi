import { createFileRoute, Outlet } from "@tanstack/react-router";
import Layout from "@/features/marketing/marketing-layout";
export const Route = createFileRoute("/_marketing")({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});
