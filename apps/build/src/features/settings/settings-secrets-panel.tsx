"use client";

import { UrlLink as Link } from "@/components/url-link";
import { ArrowRight } from "lucide-react";

import { useProjects } from "@/features/deploy/hooks/use-projects";
import { platformHref } from "@/features/deploy/platform";
import { usePlatform } from "@/features/deploy/use-platform";
import {
  ErrorPanel,
  GitHubSignInPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";

function environmentHref(projectId: number, platform: string) {
  return platformHref(`/projects/${projectId}?tab=environment`, platform);
}

function projectLabel(source: { id: number; repositoryLink?: string | null }) {
  return source.repositoryLink?.trim() || `Project ${source.id}`;
}

export function SettingsSecretsPanel() {
  // Settings carries no `?platform=`, but its project list is not an exception
  // to the platform model: an unscoped read here listed every project the
  // account owns, including ones this platform cannot open — following one of
  // those rows lands on an Environment tab whose secrets read fails.
  const platform = usePlatform();
  const { state } = useProjects(platform);

  if (state.status === "loading") {
    return <LoadingPanel label="Loading projects…" />;
  }

  if (state.status === "signed_out") {
    return <GitHubSignInPanel error={null} />;
  }

  if (state.status === "error") {
    return <ErrorPanel message={state.error} />;
  }

  if (state.projects.length === 0) {
    return (
      <div className="border-border bg-surface-1 rounded-lg border p-4">
        <div className="text-foreground text-sm font-medium">
          No projects yet
        </div>
        <p className="text-dim mt-2 text-[13px]">
          Create an app first, then set secrets on its Environment tab.
        </p>
        <Link
          href={platformHref("/operate/deployments/new", platform)}
          className="bg-primary text-primary-foreground hover:bg-brand-hover mt-4 inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium transition"
        >
          New app
        </Link>
      </div>
    );
  }

  if (state.projects.length === 1) {
    const only = state.projects[0]!;
    const label = projectLabel(only);

    return (
      <div className="space-y-3">
        <div className="border-border bg-surface-1 rounded-lg border p-4">
          <div className="text-foreground text-sm font-medium">
            Per-project secrets
          </div>
          <p className="text-dim mt-2 text-[13px]">
            Edit environment values for{" "}
            <span className="text-foreground font-medium">{label}</span> on the
            project Environment tab.
          </p>
          <Link
            href={environmentHref(only.id, platform)}
            className="bg-primary text-primary-foreground hover:bg-brand-hover mt-4 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition"
          >
            Open Environment
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border-border bg-surface-1 rounded-lg border p-4">
        <div className="text-foreground text-sm font-medium">
          Per-project secrets
        </div>
        <p className="text-dim mt-2 text-[13px]">
          Choose a project to open its Environment tab.
        </p>
      </div>

      <ul className="divide-border border-border bg-surface-1 divide-y overflow-hidden rounded-lg border">
        {state.projects.map((source) => (
          <li key={source.id}>
            <Link
              href={environmentHref(source.id, platform)}
              className="hover:bg-accent-hover flex items-center justify-between gap-3 px-4 py-3 transition"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">
                  {projectLabel(source)}
                </div>
                <div className="text-dim mt-0.5 text-xs">Environment</div>
              </div>
              <ArrowRight className="text-dim size-4 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
