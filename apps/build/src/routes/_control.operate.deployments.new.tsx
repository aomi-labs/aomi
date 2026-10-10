import { createFileRoute } from "@tanstack/react-router";
import { NewProject } from "@/features/deploy/components/deployments/new-project";
import { newProjectMode } from "@/features/deploy/new-project-mode";
import { platformHref, platformParam } from "@/features/deploy/platform";

export const Route = createFileRoute("/_control/operate/deployments/new")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  component: NewOperateDeploymentPage,
});

function NewOperateDeploymentPage() {
  const searchParams = Route.useSearch();
  const params = searchParams;
  const platform = platformParam(params.platform);
  return (
    <NewProject
      platform={platform}
      mode={newProjectMode(params.mode)}
      backHref={platformHref("/projects", platform)}
      backLabel="Projects"
    />
  );
}
