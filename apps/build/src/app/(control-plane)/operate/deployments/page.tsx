import { Suspense } from "react";
import { ErrorBoundary } from "@/components/shell/error-boundary";
import { GlobalDeploymentsList } from "@/features/deploy/components/deployments/global-deployments-list";
import { platformParam } from "@/features/deploy/platform";

export default async function OperateDeploymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string | string[] }>;
}) {
  const { platform } = await searchParams;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <GlobalDeploymentsList platform={platformParam(platform)} />
      </Suspense>
    </ErrorBoundary>
  );
}
