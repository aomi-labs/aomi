import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { ErrorBoundary } from "@/components/shell/error-boundary";
import { GlobalDeploymentsList } from "@/features/deploy/components/deployments/global-deployments-list";
import { platformParam } from "@/features/deploy/platform";

export const Route = createFileRoute("/_control/operate/deployments/")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  component: OperateDeploymentsPage,
});

function OperateDeploymentsPage() {
  const searchParams = Route.useSearch();
  const { platform } = searchParams;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <GlobalDeploymentsList platform={platformParam(platform)} />
      </Suspense>
    </ErrorBoundary>
  );
}
