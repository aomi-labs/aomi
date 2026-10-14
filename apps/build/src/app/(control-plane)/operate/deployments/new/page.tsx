import { NewProject } from "@/features/deploy/components/deployments/new-project";
import { newProjectMode } from "@/features/deploy/new-project-mode";
import { platformHref, platformParam } from "@/features/deploy/platform";

export default async function NewOperateDeploymentPage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string | string[];
    mode?: string | string[];
  }>;
}) {
  const params = await searchParams;
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
