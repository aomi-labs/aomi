"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchProjectDetail } from "@build/components/control-plane/prefetch-control-plane-route";
import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { platformHref } from "@build/features/launch/platform";
import { setLastProjectId } from "@build/lib/last-project";
import { ProjectHeader } from "./project-header";
import { ChatTab } from "./tabs/chat-tab";
import { DeploymentsTab } from "./tabs/deployments-tab";
import { EnvironmentTab } from "./tabs/environment-tab";
import { HomeTab } from "./tabs/home-tab";
import { ProvidersTab } from "./tabs/providers-tab";
import { SettingsTab } from "./tabs/settings-tab";
import { LoadingPanel, ErrorPanel } from "./ui/state-panels";

const TABS = [
  { id: "home", label: "Home" },
  { id: "deployments", label: "Deployments" },
  { id: "providers", label: "Providers" },
  { id: "environment", label: "Environment" },
  { id: "chat", label: "Chat" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ProjectPage({
  projectId,
  backHref = "/operate/deployments",
  backLabel = "Deployments",
  tabBaseHref,
  tabHref,
}: {
  projectId: number;
  backHref?: string;
  backLabel?: string;
  tabBaseHref?: string;
  tabHref?: (tab: TabId) => string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const detail = useProjectDetail(projectId);
  const { accountKey, loadSecrets } = detail;
  const raw = searchParams.get("tab");
  const active: TabId = TABS.some((t) => t.id === raw)
    ? (raw as TabId)
    : "home";
  const projectTabHref = (tab: TabId) => {
    if (tabHref) return tabHref(tab);
    const params = new URLSearchParams();
    if (!tabBaseHref) params.set("project", String(projectId));
    params.set("tab", tab);
    return platformHref(
      `${tabBaseHref ?? "/operate/deployments"}?${params}`,
      detail.source?.platformName,
    );
  };
  const openEnvironment = () => router.push(projectTabHref("environment"));
  const queryClient = useQueryClient();

  useEffect(() => {
    setLastProjectId(projectId);
  }, [projectId]);

  // Start every read this page needs in parallel on mount instead of
  // waterfalling them behind the source list: usage/SDK warm through the same
  // prefetch the sidebar hover uses (deduped by react-query), and secrets —
  // which only need the source id — fire for the tabs that render them.
  useEffect(() => {
    if (accountKey) {
      prefetchProjectDetail(queryClient, accountKey, projectId);
    }
  }, [accountKey, queryClient, projectId]);
  useEffect(() => {
    if (active === "environment") {
      for (const app of detail.source?.apps ?? []) loadSecrets(app.id);
    }
  }, [active, detail.source?.apps, loadSecrets]);

  return (
    <main className="bg-background text-foreground min-h-screen">
      <ProjectHeader
        source={detail.source}
        latest={detail.source?.latestDeployment ?? null}
        onRefresh={detail.reload}
        backHref={platformHref(backHref, detail.source?.platformName)}
        backLabel={backLabel}
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {detail.source?.configuration?.status === "invalid" ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
          >
            <div className="text-sm font-medium">
              Project configuration invalid
            </div>
            <p className="text-dim mt-1 text-xs leading-5">
              {detail.source.configuration.reason.replaceAll("-", " ")} at
              revision{" "}
              <span className="font-mono">
                {detail.source.configuration.checkedRevision.slice(0, 12)}
              </span>
              . Existing deployments, history, and observability remain
              available.
            </p>
          </div>
        ) : null}
        <div
          role="tablist"
          className="bg-surface-2 mb-4 flex w-fit items-center gap-1 rounded-md p-1 text-sm"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active === tab.id}
              onClick={() => router.push(projectTabHref(tab.id))}
              className={`h-7 rounded px-2.5 text-xs font-medium ${
                active === tab.id
                  ? "bg-surface-1 text-foreground shadow-sm"
                  : "text-dim"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="border-border bg-surface-1 overflow-hidden rounded-lg border">
          {detail.loading && detail.source === null && !detail.error ? (
            <LoadingPanel label="Loading project…" />
          ) : detail.error ? (
            <ErrorPanel message={detail.error} />
          ) : active === "home" ? (
            // Details is merged into Home: status cards first, repo
            // metadata (the former Details tab) below.
            <>
              <HomeTab detail={detail} tabHref={projectTabHref} />
              <SettingsTab detail={detail} />
            </>
          ) : active === "deployments" ? (
            <DeploymentsTab
              detail={detail}
              onOpenEnvironment={openEnvironment}
            />
          ) : active === "providers" ? (
            <ProvidersTab detail={detail} />
          ) : active === "environment" ? (
            <EnvironmentTab detail={detail} />
          ) : (
            <ChatTab detail={detail} />
          )}
        </div>
      </div>
    </main>
  );
}
