import { createFileRoute } from "@tanstack/react-router";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { platformParam } from "@/features/deploy/platform";

export const Route = createFileRoute("/_control/overview")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  component: OverviewPage,
});

function OverviewPage() {
  const searchParams = Route.useSearch();
  const { platform } = searchParams;
  return <OverviewDashboard platform={platformParam(platform)} />;
}
