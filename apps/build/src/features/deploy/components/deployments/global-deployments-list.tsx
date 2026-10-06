"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, RefreshCw, Rocket } from "lucide-react";
import { EmptyState } from "@build/components/control-plane/empty-state";
import { platformHref } from "@build/features/launch/platform";
import { useGlobalDeploymentRecords } from "./use-global-deployment-records";
import { ErrorPanel, GitHubSignInPanel, LoadingPanel } from "./ui/state-panels";

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}

function deploymentsHref(
  platform: string,
  values: { project?: string; deployment?: string } = {},
) {
  const params = new URLSearchParams({ platform });
  if (values.project) params.set("project", values.project);
  if (values.deployment) params.set("deployment", values.deployment);
  return `/operate/deployments?${params}`;
}

function DeploymentsPageHeader({
  platform,
  onReload,
}: {
  platform: string;
  onReload: () => void;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Rocket className="text-dim size-5" aria-hidden />
          <h1 className="font-display text-xl font-normal tracking-tight">
            Deployments
          </h1>
        </div>
        <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
          Deployment history for projects on {platform}.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReload}
          className="border-border bg-surface-1 hover:bg-accent-hover inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Refresh
        </button>
        <Link
          href={platformHref("/operate/deployments/new", platform)}
          prefetch={false}
          className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
        >
          New app
        </Link>
      </div>
    </header>
  );
}

export function GlobalDeploymentsList({ platform }: { platform: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    projectsState,
    recordsState,
    projects,
    reload,
    loadMore,
    hasMore,
    loadingMore,
  } = useGlobalDeploymentRecords(platform);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "current" | "previous">("all");
  const projectParam = searchParams.get("project");
  const selectedDeploymentId = searchParams.get("deployment");
  const [sourceFilter, setSourceFilter] = useState(projectParam ?? "all");

  useEffect(() => {
    setSourceFilter(projectParam ?? "all");
  }, [projectParam]);

  const deployments = useMemo(
    () =>
      recordsState.status === "ready" || recordsState.status === "error"
        ? recordsState.deployments
        : [],
    [recordsState],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deployments.filter((deployment) => {
      if (
        sourceFilter !== "all" &&
        String(deployment.projectId) !== sourceFilter
      ) {
        return false;
      }
      if (status === "current" && !deployment.current) return false;
      if (status === "previous" && deployment.current) return false;
      if (!q) return true;
      return [
        deployment.deploymentId,
        deployment.commit,
        deployment.repositoryLink,
        ...deployment.apps,
        ...deployment.releaseTags,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [deployments, query, sourceFilter, status]);

  const selectedDeployment = useMemo(
    () =>
      selectedDeploymentId
        ? deployments.find(
            (deployment) =>
              deployment.deploymentId === selectedDeploymentId &&
              (projectParam == null ||
                String(deployment.projectId) === projectParam),
          )
        : null,
    [deployments, projectParam, selectedDeploymentId],
  );

  if (projectsState.status !== "ready") {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <DeploymentsPageHeader platform={platform} onReload={reload} />
        {projectsState.status === "loading" ? (
          <LoadingPanel label="Loading projects…" />
        ) : projectsState.status === "signed_out" ? (
          <GitHubSignInPanel error={null} />
        ) : (
          <ErrorPanel message={projectsState.error} />
        )}
      </div>
    );
  }

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <DeploymentsPageHeader platform={platform} onReload={reload} />

        <div className="border-border bg-surface-1 rounded-lg border">
          <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <Filter className="text-dim size-4" aria-hidden />
            <select
              value={sourceFilter}
              onChange={(event) => {
                const value = event.target.value;
                setSourceFilter(value);
                if (value !== "all") {
                  router.push(deploymentsHref(platform, { project: value }));
                } else {
                  router.push(deploymentsHref(platform));
                }
              }}
              className="border-border bg-surface-1 h-8 rounded-md border px-2 text-sm"
            >
              <option value="all">All projects</option>
              {projects.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.repositoryLink ?? `Project ${source.id}`}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "all" | "current" | "previous")
              }
              className="border-border bg-surface-1 h-8 rounded-md border px-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="current">Current</option>
              <option value="previous">Previous</option>
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search deployment, app, commit, release tag"
              className="border-border h-8 min-w-[260px] flex-1 rounded-md border px-2 text-sm"
            />
          </div>

          {selectedDeployment ? (
            <div className="border-border bg-surface-2 border-b px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-dim text-xs font-medium uppercase tracking-wide">
                    Selected deployment
                  </div>
                  <div className="mt-1 truncate font-mono text-sm font-medium">
                    {selectedDeployment.deploymentId}
                  </div>
                  <div className="text-dim mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>
                      {selectedDeployment.repositoryLink ?? "Unknown project"}
                    </span>
                    <span>
                      {selectedDeployment.apps.join(", ") || "no apps"}
                    </span>
                    <span>
                      {selectedDeployment.current ? "Current" : "Previous"}
                    </span>
                    <span>{formatDate(selectedDeployment.createdAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={platformHref(
                      `/projects/${selectedDeployment.projectId}`,
                      platform,
                    )}
                    prefetch={false}
                    className="border-border bg-surface-1 hover:bg-accent-hover inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
                  >
                    Open project
                  </Link>
                  <Link
                    href={
                      projectParam
                        ? deploymentsHref(platform, { project: projectParam })
                        : deploymentsHref(platform)
                    }
                    prefetch={false}
                    className="border-border bg-surface-1 hover:bg-accent-hover inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
                  >
                    Clear selection
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {recordsState.status === "loading" ||
          recordsState.status === "idle" ? (
            <LoadingPanel label="Loading deployments…" />
          ) : recordsState.status === "error" ? (
            <ErrorPanel message={recordsState.error} />
          ) : filtered.length === 0 ? (
            deployments.length === 0 ? (
              <EmptyState
                title="No deployments yet"
                description="Deploy an app from a connected project to see history here."
                actionHref={platformHref("/operate/deployments/new", platform)}
                actionLabel="New app"
              />
            ) : (
              <EmptyState
                title="No matching deployments"
                description="Clear filters or pick another project."
              />
            )
          ) : (
            <div className="divide-border divide-y">
              {filtered.map((deployment) => (
                <Link
                  key={`${deployment.projectId}-${deployment.deploymentId}`}
                  href={deploymentsHref(platform, {
                    project: String(deployment.projectId),
                    deployment: deployment.deploymentId,
                  })}
                  prefetch={false}
                  className="hover:bg-accent-hover grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">
                        {deployment.deploymentId}
                      </div>
                      {deployment.current && (
                        <span className="bg-positive/10 text-positive shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-dim mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>
                        {deployment.repositoryLink ?? "Unknown project"}
                      </span>
                      <span>{deployment.apps.join(", ") || "no apps"}</span>
                      <span className="font-mono">
                        {deployment.commit ?? "unknown commit"}
                      </span>
                      <span>{formatDate(deployment.createdAt)}</span>
                    </div>
                  </div>
                  <span className="text-dim text-xs font-medium">
                    View deployment
                  </span>
                </Link>
              ))}
              {hasMore ? (
                <div className="flex justify-center px-4 py-3">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="border-border bg-surface-1 hover:bg-accent-hover h-8 rounded-md border px-3 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
