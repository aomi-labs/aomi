"use client";

import { useState } from "react";
import { ExternalLink, Loader2, RotateCcw } from "lucide-react";
import type {
  GitHubRepositoryAccess,
  GitHubRepositoryAccessStatus,
} from "@aomi-labs/deploy";

import { githubAppInstallUrl } from "@build/features/launch/client";
import { useGitHubAppInstallations } from "@build/features/launch/hooks/use-github-app";
import {
  ErrorPanel,
  GitHubSignInPanel,
  LoadingPanel,
} from "@build/features/launch/components/deployments/ui/state-panels";

const button =
  "border-border hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50";

const accessLabel: Record<GitHubRepositoryAccessStatus, string> = {
  ok: "Access OK",
  missing_permissions: "Permissions missing",
  suspended: "Suspended",
  not_installed: "Action required",
  error: "Check failed",
};

const accessDescription: Record<GitHubRepositoryAccessStatus, string> = {
  ok: "Aomi can read this repository.",
  missing_permissions: "Grant Contents: read access to this repository.",
  suspended: "Restore this GitHub App installation.",
  not_installed: "Install the GitHub App and select this repository.",
  error: "Aomi couldn’t verify this repository. Re-check to try again.",
};

function badgeClass(status: GitHubRepositoryAccessStatus) {
  if (status === "ok") return "border-positive/40 bg-positive/10 text-positive";
  if (status === "missing_permissions" || status === "not_installed") {
    return "border-warning/40 bg-warning/10 text-warning";
  }
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

function RepositoryRow({
  repository,
  opening,
  onGrant,
}: {
  repository: GitHubRepositoryAccess;
  opening: boolean;
  onGrant: () => void;
}) {
  return (
    <li className="border-border bg-surface-1 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-foreground truncate font-mono text-sm font-medium">
            {repository.githubRepo}
          </div>
          <div className="text-dim mt-1 text-xs">{repository.platform}</div>
        </div>
        <span
          className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] ${badgeClass(repository.status)}`}
        >
          {accessLabel[repository.status]}
        </span>
      </div>
      <p className="text-dim mt-3 text-[13px]">
        {accessDescription[repository.status]}
      </p>
      {repository.status !== "error" &&
        (repository.settingsUrl ? (
          <a
            className={`${button} mt-3`}
            href={repository.settingsUrl}
            target="_blank"
            rel="noreferrer"
          >
            {repository.status === "ok" ? "Manage" : "Review access"}
            <ExternalLink className="size-3" />
          </a>
        ) : repository.status !== "ok" ? (
          <button
            type="button"
            className={`${button} mt-3`}
            onClick={onGrant}
            disabled={opening}
          >
            {opening ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ExternalLink className="size-3" />
            )}
            {opening ? "Opening GitHub…" : "Grant access"}
          </button>
        ) : null)}
    </li>
  );
}

export function SettingsGitHubAppPanel() {
  const { state, refetch, refetching } = useGitHubAppInstallations();
  const [openingProjectId, setOpeningProjectId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function grant(repository: GitHubRepositoryAccess) {
    setOpeningProjectId(repository.projectId);
    setActionError(null);
    try {
      window.location.assign(
        await githubAppInstallUrl({
          platform: repository.platform,
          repo: repository.githubRepo,
          returnTo: `${window.location.origin}/settings/general#github-app`,
        }),
      );
    } catch {
      setOpeningProjectId(null);
      setActionError("Couldn’t open GitHub. Try again.");
    }
  }

  return (
    <section id="github-app" className="max-w-2xl scroll-mt-24 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <h2 className="font-display text-foreground text-lg font-normal tracking-tight">
            GitHub repository access
          </h2>
          <p className="text-subtle text-sm leading-6">
            Aomi checks only repositories connected as your projects. Deployment
            infrastructure is managed by Aomi.
          </p>
        </div>
        {state.status !== "loading" && state.status !== "signed_out" && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setActionError(null);
              refetch();
            }}
            disabled={refetching}
          >
            <RotateCcw
              className={`size-3 ${refetching ? "animate-spin" : ""}`}
            />
            {refetching ? "Checking…" : "Re-check"}
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <LoadingPanel label="Checking GitHub repository access…" />
      )}
      {state.status === "signed_out" && <GitHubSignInPanel error={null} />}
      {state.status === "error" && <ErrorPanel message={state.error} />}
      {state.status === "ready" && state.report.repositories.length === 0 && (
        <p className="text-dim text-sm">
          No repositories are connected yet. Access is requested when you create
          or import an app.
        </p>
      )}
      {state.status === "ready" && state.report.repositories.length > 0 && (
        <div className="space-y-3">
          <p className="text-dim text-sm">
            {state.report.status === "ok"
              ? `All ${state.report.repositories.length} connected repositories are accessible.`
              : "Some connected repositories need attention."}
          </p>
          <ul className="space-y-3">
            {state.report.repositories.map((repository) => (
              <RepositoryRow
                key={repository.projectId}
                repository={repository}
                opening={openingProjectId === repository.projectId}
                onGrant={() => void grant(repository)}
              />
            ))}
          </ul>
        </div>
      )}
      {actionError && (
        <p role="alert" className="text-destructive text-sm">
          {actionError}
        </p>
      )}
    </section>
  );
}
