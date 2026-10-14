import { ErrorBoundary } from "@/components/shell/error-boundary";
import { connectionResult } from "@aomi-labs/deploy/launch";
import { ProjectIndex } from "@/features/deploy/components/deployments/project-index";
import { platformParam } from "@/features/deploy/platform";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string | string[];
    launch?: string | string[];
    repo?: string | string[];
    github_error?: string | string[];
  }>;
}) {
  const {
    platform: rawPlatform,
    launch: rawLaunch,
    repo: rawRepo,
    github_error: rawGithubError,
  } = await searchParams;
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
