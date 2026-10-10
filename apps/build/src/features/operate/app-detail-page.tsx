"use client";

import { useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useGitHubSession } from "@/components/control-plane/github-session-context";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "@/features/deploy/query-keys";
import {
  GitHubSignInPanel,
  LoadingPanel,
} from "@/features/deploy/components/deployments/ui/state-panels";
import { AppDetailView } from "./app-detail-view";
import { operateAppDetailFetch } from "./client";
import {
  liveAppDetailView,
  type LiveAppDetailPayload,
} from "./live-app-detail";

function operateHref(
  path: string,
  values: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function AppDetailPage({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const { account } = useGitHubSession();
  const accountKey = githubAccountKey(account.githubLogin);
  const detailQuery = useQuery({
    queryKey: buildQueryKeys.applicationDetail(
      accountKey ?? "unavailable",
      applicationId,
    ),
    queryFn: () => operateAppDetailFetch<LiveAppDetailPayload>(applicationId),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  const payload = detailQuery.data ?? null;
  const error = detailQuery.error
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : "Detail request failed"
    : null;

  if (account.loading) {
    return <LoadingPanel label="Checking GitHub session..." />;
  }
  if (!account.signedIn) {
    return <GitHubSignInPanel error={null} />;
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-20 text-center">
        <h1 className="font-display text-lg font-normal tracking-tight">
          Observability unavailable
        </h1>
        <p className="text-dim text-sm">{error}</p>
        <button
          type="button"
          onClick={() => void detailQuery.refetch()}
          className="border-border bg-surface hover:bg-accent-hover rounded-md border px-3 py-1.5 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="text-dim px-6 py-20 text-center text-sm">
        Loading live observability…
      </div>
    );
  }

  const view = liveAppDetailView(payload);
  const application = payload.detail.app.name;
  const projectValue = String(payload.detail.project.id);
  return (
    <AppDetailView
      app={view.app}
      onBack={() =>
        router.navigate({
          href: operateHref("/operate/observability", {
            project: projectValue,
          }),
        })
      }
      onOpenTrace={(tool) =>
        router.navigate({
          href: operateHref("/operate/logs", {
            app: application,
            tool,
            project: projectValue,
          }),
        })
      }
      onOpenTx={(tx) =>
        router.navigate({
          href: operateHref("/operate/transactions", {
            app: application,
            tx,
            project: projectValue,
          }),
        })
      }
    />
  );
}
