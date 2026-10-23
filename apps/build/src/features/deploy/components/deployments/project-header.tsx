import type {
  UserProject,
  UserProjectLatestDeployment,
} from "@aomi-labs/deploy";
import { Github } from "lucide-react";
import { DeploymentStatusPill } from "@/features/deploy/components/deployments/deployment-status";

export function ProjectHeader({
  source,
  latest,
  onRefresh,
  backHref = "/operate/deployments",
  backLabel = "Deployments",
}: {
  source: UserProject | null;
  latest: UserProjectLatestDeployment | null;
  onRefresh: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  const repoUrl = source?.repositoryLink
    ? source.repositoryLink.startsWith("http")
      ? source.repositoryLink
      : `https://github.com/${source.repositoryLink}`
    : null;
  return (
    <header className="border-border flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <a href={backHref} className="text-dim hover:text-foreground">
          {backLabel}
        </a>
        <span className="text-dim">/</span>
        <span className="truncate font-semibold">
          {source?.repositoryLink ?? "Project"}
        </span>
        {latest?.state && <DeploymentStatusPill value={latest.state} />}
      </div>
      <div className="flex items-center gap-2">
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="border-border hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
          >
            <Github className="size-3.5" aria-hidden />
            GitHub
          </a>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="border-border bg-surface-1 hover:bg-accent-hover inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
        >
          Refresh
        </button>
      </div>
    </header>
  );
}
