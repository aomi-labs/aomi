"use client";

import { Activity, Gauge, Home, Rocket, WalletCards } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ControlPlaneLink } from "@/components/control-plane/control-plane-link";
import { useGitHubSession } from "@/components/control-plane/github-session-context";
import { EmptyState } from "@/components/control-plane/empty-state";
import {
  ErrorPanel,
  GitHubSignInPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import { useGlobalDeploymentRecords } from "@/features/deploy/components/deployments/use-global-deployment-records";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "@/features/deploy/query-keys";
import { operateFetch } from "@/features/operate/client";
import { BUILD_GLOSSARY } from "@/lib/glossary";
import { lastUsageHref, projectHref } from "@/lib/deep-links";
import { getLastProjectId } from "@/lib/last-project";
import { platformHref } from "@/features/deploy/platform";

type UsagePayload = {
  daily?: Array<Record<string, any>>;
  breakdown?: Array<Record<string, any>>;
};

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="border-border bg-surface-1 rounded-md border px-4 py-3">
      <div className="text-dim text-xs">{label}</div>
      <div className="text-foreground mt-2 text-2xl font-semibold">{value}</div>
      <div className="text-dim mt-1 text-xs">{helper}</div>
    </div>
  );
}

export function OverviewDashboard({ platform }: { platform: string }) {
  const { account } = useGitHubSession();
  const { projectsState, recordsState, projects, reload } =
    useGlobalDeploymentRecords(platform);
  const accountKey = githubAccountKey(account.githubLogin);
  const usageQuery = useQuery({
    queryKey: buildQueryKeys.operate(accountKey ?? "unavailable", "usage"),
    queryFn: () => operateFetch<UsagePayload>("usage"),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  const usage = usageQuery.data ?? null;
  const usageError = usageQuery.error
    ? usageQuery.error instanceof Error
      ? usageQuery.error.message
      : String(usageQuery.error)
    : null;

  const deployments =
    recordsState.status === "ready" || recordsState.status === "error"
      ? recordsState.deployments
      : [];
  const currentDeployments = deployments.filter(
    (deployment) => deployment.current,
  );
  const latestDeployment = deployments[0] ?? null;
  const usageTotals = useMemo(() => {
    const daily = usage?.daily ?? [];
    return daily.reduce(
      (acc, row) => ({
        inputTokens: acc.inputTokens + numberValue(row.inputTokens),
        outputTokens: acc.outputTokens + numberValue(row.outputTokens),
        creditsUsed: acc.creditsUsed + numberValue(row.creditsUsed),
      }),
      { inputTokens: 0, outputTokens: 0, creditsUsed: 0 },
    );
  }, [usage]);

  // Only the (fast) session check blocks the page. While the project list is
  // still loading, the shell renders immediately with placeholder stats so the
  // user never stares at a full-page spinner waiting for projects.
  if (account.loading) {
    return <LoadingPanel label="Loading overview..." />;
  }
  if (!account.signedIn || projectsState.status === "signed_out") {
    return <GitHubSignInPanel error={null} />;
  }
  if (projectsState.status === "error") {
    return <ErrorPanel message={projectsState.error} />;
  }
  const projectsLoading = projectsState.status === "loading";
  const recordsPending =
    projectsLoading ||
    recordsState.status === "idle" ||
    recordsState.status === "loading";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Home className="text-dim size-5" aria-hidden />
            <h1 className="font-display text-foreground text-xl font-normal tracking-tight">
              Overview
            </h1>
          </div>
          <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
            Snapshot for{" "}
            {account.githubLogin ? `@${account.githubLogin}` : "GitHub"}.
            Day-to-day work starts from Projects.
          </p>
          <p className="text-dim mt-1 max-w-3xl text-xs leading-5">
            {BUILD_GLOSSARY.project.term}: {BUILD_GLOSSARY.project.meaning}{" "}
            {BUILD_GLOSSARY.deployment.term}:{" "}
            {BUILD_GLOSSARY.deployment.meaning}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="border-border bg-surface hover:bg-accent-hover h-8 rounded-md border px-3 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Projects"
          value={projectsLoading ? "—" : String(projects.length)}
          helper={platform ? `Projects on ${platform}` : "Projects on GitHub"}
        />
        <StatCard
          label="Live deployments"
          value={recordsPending ? "—" : String(currentDeployments.length)}
          helper="Active releases"
        />
        <StatCard
          label="Credits"
          value={formatNumber(usageTotals.creditsUsed)}
          helper="Usage by app"
        />
        <StatCard
          label="Tokens"
          value={formatNumber(
            usageTotals.inputTokens + usageTotals.outputTokens,
          )}
          helper="Input and output tokens"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border-border bg-surface-1 rounded-md border">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <div>
              <div className="text-foreground text-sm font-medium">
                Recent deployments
              </div>
              <div className="text-dim text-xs">Latest project activity</div>
            </div>
            <ControlPlaneLink
              href={platformHref("/operate/deployments", platform)}
              className="text-dim hover:text-foreground text-sm"
            >
              View all
            </ControlPlaneLink>
          </div>
          {recordsPending ? (
            <LoadingPanel label="Loading deployments..." />
          ) : recordsState.status === "error" ? (
            <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
              {recordsState.error}
            </div>
          ) : null}
          {recordsState.status === "ready" && deployments.length === 0 ? (
            <EmptyState
              title="No deployments yet"
              description={BUILD_GLOSSARY.deployment.meaning}
              actionHref={platformHref("/operate/deployments/new", platform)}
              actionLabel="New app"
            />
          ) : !recordsPending ? (
            <div className="divide-border divide-y">
              {deployments.slice(0, 5).map((deployment) => (
                <ControlPlaneLink
                  key={`${deployment.projectId}-${deployment.deploymentId}`}
                  href={platformHref(
                    projectHref(deployment.projectId, "deployments"),
                    platform,
                  )}
                  className="hover:bg-accent-hover flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="text-foreground truncate font-mono text-xs">
                      {deployment.deploymentId}
                    </div>
                    <div className="text-dim mt-1 truncate text-xs">
                      {deployment.repositoryLink ?? "Unknown project"} ·{" "}
                      {deployment.apps.join(", ")}
                    </div>
                  </div>
                  <span className="border-border text-dim shrink-0 rounded-sm border px-2 py-0.5 text-xs">
                    {deployment.current ? "Current" : "Previous"}
                  </span>
                </ControlPlaneLink>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <ControlPlaneLink
            href={platformHref("/operate/deployments/new", platform)}
            className="border-border bg-surface-1 hover:bg-accent-hover rounded-md border p-4"
          >
            <Rocket className="text-dim size-4" aria-hidden />
            <div className="text-foreground mt-3 text-sm font-medium">
              Deploy a new app
            </div>
            <div className="text-dim mt-1 text-xs">
              Fork, connect, and publish from GitHub.
            </div>
          </ControlPlaneLink>
          <ControlPlaneLink
            href="/operate/transactions"
            className="border-border bg-surface-1 hover:bg-accent-hover rounded-md border p-4"
          >
            <WalletCards className="text-dim size-4" aria-hidden />
            <div className="text-foreground mt-3 text-sm font-medium">
              Review transactions
            </div>
            <div className="text-dim mt-1 text-xs">
              Owned app transaction history.
            </div>
          </ControlPlaneLink>
          <ControlPlaneLink
            href="/operate/observability"
            className="border-border bg-surface-1 hover:bg-accent-hover rounded-md border p-4"
          >
            <Activity className="text-dim size-4" aria-hidden />
            <div className="text-foreground mt-3 text-sm font-medium">
              Check app health
            </div>
            <div className="text-dim mt-1 text-xs">
              Status and dashboard links.
            </div>
          </ControlPlaneLink>
          <ControlPlaneLink
            href={lastUsageHref()}
            className="border-border bg-surface-1 hover:bg-accent-hover rounded-md border p-4"
          >
            <Gauge className="text-dim size-4" aria-hidden />
            <div className="text-foreground mt-3 text-sm font-medium">
              Inspect usage
            </div>
            <div className="text-dim mt-1 text-xs">
              {usageError
                ? `Usage unavailable: ${usageError}`
                : getLastProjectId()
                  ? "Credits for last project"
                  : latestDeployment
                    ? "Credits by app"
                    : "Appears after app traffic"}
            </div>
          </ControlPlaneLink>
        </div>
      </section>
    </div>
  );
}
