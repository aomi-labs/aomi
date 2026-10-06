import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { platformParam } from "@/features/deploy/platform";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string | string[] }>;
}) {
  const { platform } = await searchParams;
  return <OverviewDashboard platform={platformParam(platform)} />;
}
