import { Suspense } from "react";
import { ErrorBoundary } from "@/components/shell/error-boundary";
import { OperateDeployments } from "@/features/deploy/components/deployments/operate-deployments";
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
        <OperateDeployments platform={platformParam(platform)} />
      </Suspense>
    </ErrorBoundary>
  );
}
