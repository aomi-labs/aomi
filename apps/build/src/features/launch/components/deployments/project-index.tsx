"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@build/components/control-plane/empty-state";
import { useProjects } from "@build/features/launch/hooks/use-projects";
import { platformHref } from "@build/features/launch/platform";
import { BUILD_GLOSSARY } from "@build/lib/glossary";
import { ProjectRow } from "./project-row";
import {
  ConnectionResultBanner,
  type RepositoryConnectionResult,
} from "./repository-connector";
import { SdkBadge } from "./ui/sdk-badge";
import { LoadingPanel, ErrorPanel, GitHubSignInPanel } from "./ui/state-panels";

export function ProjectIndex({
  platform,
  connectionResult,
}: {
  platform?: string;
  connectionResult?: RepositoryConnectionResult;
}) {
  const { state, reload } = useProjects(platform);
  const router = useRouter();
  useEffect(() => {
    if (
      connectionResult?.status !== "success" ||
      !connectionResult.repo ||
      state.status !== "ready"
    )
      return;
    const project = state.projects.find(
      (project) =>
        project.repositoryLink.toLowerCase() ===
        connectionResult.repo!.toLowerCase(),
    );
    if (project)
      router.replace(
        `/projects/${project.id}?tab=deployments&platform=${encodeURIComponent(project.platformName ?? platform ?? "community")}`,
      );
  }, [connectionResult, state, platform, router]);
  const requiredSdk =
    state.status === "ready" || state.status === "signed_out"
      ? state.sdk?.sdkStatus.requiredVersion
      : null;
  const githubError =
    connectionResult?.status === "error" ? connectionResult.message : null;

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderKanban className="text-dim size-5" aria-hidden />
              <h1 className="font-display text-xl font-normal tracking-tight">
                Projects
              </h1>
            </div>
            <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
              {BUILD_GLOSSARY.project.meaning} Each project can contain apps,
              deployments, and an environment for keys.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={reload}
              className="border-border bg-surface-1 hover:bg-accent-hover inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium"
            >
              Refresh
            </button>
            <a
              href={platformHref("/operate/deployments/new", platform)}
              className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
            >
              New app
            </a>
          </div>
        </div>

        {requiredSdk && (
          <div className="border-border bg-surface-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="text-dim">Backend requires aomi-sdk</span>
            <SdkBadge stamped={requiredSdk} required={requiredSdk} />
          </div>
        )}

        {/* Importing starts on the New app page; GitHub sends the user back
            here, so this page reports the outcome. */}
        {platform && (
          <ConnectionResultBanner
            platform={platform}
            result={connectionResult}
          />
        )}

        <div className="border-border bg-surface-1 overflow-hidden rounded-lg border">
          <div className="border-border flex h-12 items-center justify-between border-b px-4">
            <div className="text-sm font-medium">Projects</div>
            <div className="text-dim text-xs">
              {state.status === "ready" ? state.projects.length : 0}
              {platform ? ` on ${platform}` : ""}
            </div>
          </div>
          {state.status === "loading" && (
            <LoadingPanel label="Loading projects…" />
          )}
          {state.status === "error" && <ErrorPanel message={state.error} />}
          {state.status === "signed_out" && (
            <GitHubSignInPanel error={githubError} />
          )}
          {state.status === "ready" && state.projects.length === 0 && (
            <EmptyState
              title="No projects yet"
              description="Import a GitHub repository to deploy your first app."
              actionHref={platformHref("/operate/deployments/new", platform)}
              actionLabel="New app"
            />
          )}
          {state.status === "ready" &&
            state.projects.map((source) => (
              <ProjectRow
                key={source.id}
                source={source}
                requiredSdk={requiredSdk}
                href={platformHref(`/projects/${source.id}`, platform)}
              />
            ))}
        </div>
      </div>
    </main>
  );
}
