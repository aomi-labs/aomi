import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/shell/error-boundary";
import { connectionResult } from "@aomi-labs/deploy/launch";
import { ProjectIndex } from "@/features/deploy/components/deployments/project-index";
import { platformParam } from "@/features/deploy/platform";

export const Route = createFileRoute("/_control/projects/")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  component: ProjectsPage,
});

function ProjectsPage() {
  const searchParams = Route.useSearch();
  const {
    platform: rawPlatform,
    launch: rawLaunch,
    repo: rawRepo,
    github_error: rawGithubError,
  } = searchParams;
  const one = (value?: string | string[]) =>
    typeof value === "string" ? value : undefined;

  return (
    <ErrorBoundary>
      <ProjectIndex
        platform={platformParam(rawPlatform)}
        connectionResult={connectionResult({
          launch: one(rawLaunch),
          repo: one(rawRepo),
          githubError: one(rawGithubError),
        })}
      />
    </ErrorBoundary>
  );
}
