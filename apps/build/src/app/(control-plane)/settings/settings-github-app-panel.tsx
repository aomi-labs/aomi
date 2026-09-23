"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import type {
  GitHubAppInstallationStatus,
  GitHubAppPermissionGap,
  PlatformInstallationStatusKind,
} from "@aomi-labs/deploy";

import { useGitHubAppInstallations } from "@build/features/launch/hooks/use-github-app";
import { usePlatform } from "@build/features/launch/use-platform";
import {
  ErrorPanel,
  GitHubSignInPanel,
  LoadingPanel,
} from "@build/features/launch/components/deployments/ui/state-panels";

const button =
  "border-border hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium disabled:opacity-50";

const accessLabel: Record<
  GitHubAppInstallationStatus | PlatformInstallationStatusKind,
  string
> = {
  ok: "Access OK",
  missing_permissions: "Permissions missing",
  suspended: "Suspended",
  not_found: "Not found",
  not_installed: "Not installed",
  app_not_configured: "App not configured",
  error: "Check failed",
};

function AccessPill({
  status,
}: {
  status: GitHubAppInstallationStatus | PlatformInstallationStatusKind;
}) {
  const tone =
    status === "ok"
      ? "border-positive/40 bg-positive/10 text-positive"
      : status === "missing_permissions" || status === "not_installed"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] ${tone}`}
    >
      {accessLabel[status]}
    </span>
  );
}

/** `actions: read → write` per gap — the exact change to accept on GitHub. */
function PermissionGaps({ gaps }: { gaps: GitHubAppPermissionGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {gaps.map((gap) => (
        <li
          key={gap.permission}
          className="bg-surface-2 text-foreground rounded-md px-2 py-0.5 font-mono text-[11px]"
        >
          {gap.permission}: {gap.granted} → {gap.required}
        </li>
      ))}
    </ul>
  );
}

function ReviewOnGitHub({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a className={button} href={href} target="_blank" rel="noreferrer">
      Review on GitHub
      <ExternalLink className="size-3" />
    </a>
  );
}

export function SettingsGitHubAppPanel() {
  // Settings has no `?platform=` of its own; the platform row must describe
  // the platform this shell is bound to, not a default.
  const platform = usePlatform();
  const { state, refetch, refetching } = useGitHubAppInstallations(platform);

  return (
    <section id="github-app" className="scroll-mt-24 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <h2 className="font-display text-foreground text-lg font-normal tracking-tight">
            GitHub App
          </h2>
          <p className="text-subtle max-w-2xl text-sm leading-6">
            Build deploys through a GitHub App installed on your repositories
            and on the platform&apos;s deployment repository. When the App asks
            for more than an installation currently grants, an owner has to
            accept the request on GitHub before deploys can succeed.
          </p>
        </div>
        {state.status !== "loading" && state.status !== "signed_out" && (
          <button
            type="button"
            className={button}
            onClick={refetch}
            disabled={refetching}
          >
            <RotateCcw className="size-3" />
            Re-check
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <LoadingPanel label="Checking GitHub App access…" />
      )}
      {state.status === "signed_out" && <GitHubSignInPanel error={null} />}
      {state.status === "error" && <ErrorPanel message={state.error} />}
      {state.status === "ready" && (
        <div className="max-w-2xl space-y-3">
          {state.report.apps.length > 0 && (
            <div className="border-border bg-surface-1 rounded-lg border p-4">
              <div className="text-foreground text-sm font-medium">
                {state.report.apps.length === 1
                  ? "Build uses this GitHub App"
                  : "Build uses these GitHub Apps"}
              </div>
              <ul className="mt-2 space-y-1.5">
                {state.report.apps.map((app) => (
                  <li key={app.appId} className="text-[13px]">
                    <a
                      className="text-foreground font-medium underline-offset-2 hover:underline"
                      href={`https://github.com/apps/${encodeURIComponent(app.slug)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {app.slug}
                    </a>
                    {app.error ? (
                      <span className="text-destructive ml-2">{app.error}</span>
                    ) : (
                      <span className="text-dim ml-2">
                        asks for{" "}
                        {Object.entries(app.declaredPermissions)
                          .map(([name, level]) => `${name}: ${level}`)
                          .join(", ") || "no permissions"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.report.platform && (
            <div className="border-border bg-surface-1 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-foreground min-w-0 truncate text-sm font-medium">
                  Deployment platform{" "}
                  <span className="font-mono">
                    {state.report.platform.name}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono">
                    {state.report.platform.githubRepo}
                  </span>
                </div>
                <AccessPill status={state.report.platform.status} />
              </div>
              <p className="text-dim mt-2 text-[13px]">
                {state.report.platform.status === "not_installed"
                  ? "The GitHub App is not installed on the platform repository, so deploy workflows cannot be dispatched."
                  : state.report.platform.status === "error"
                    ? (state.report.platform.error ??
                      "GitHub App access for the platform could not be checked.")
                    : (state.report.platform.installation?.error ??
                      `Deploys need ${Object.entries(
                        state.report.platform.required,
                      )
                        .map(([name, level]) => `${name}: ${level}`)
                        .join(", ")} on this repository.`)}
              </p>
              {state.report.platform.installation && (
                <>
                  <PermissionGaps
                    gaps={state.report.platform.installation.missingPermissions}
                  />
                  <div className="mt-3 flex gap-2">
                    <ReviewOnGitHub
                      href={state.report.platform.installation.settingsUrl}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {state.report.installations.length === 0 ? (
            <div className="border-border bg-surface-1 rounded-lg border p-4">
              <div className="text-foreground text-sm font-medium">
                Your installations
              </div>
              <p className="text-dim mt-2 text-[13px]">
                No GitHub App installation is linked to your projects yet.
              </p>
            </div>
          ) : (
            <ul className="divide-border border-border bg-surface-1 divide-y overflow-hidden rounded-lg border">
              {state.report.installations.map((installation) => (
                <li key={installation.installationId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-foreground truncate text-sm font-medium">
                        {installation.account.login}
                        <span className="text-dim ml-2 text-xs font-normal">
                          {installation.account.type}
                          {installation.appSlug
                            ? ` · ${installation.appSlug}`
                            : ""}
                        </span>
                      </div>
                      <div className="text-dim mt-0.5 truncate text-xs">
                        {installation.repositories.length > 0
                          ? installation.repositories.join(", ")
                          : "No owned project on this installation"}
                      </div>
                    </div>
                    <AccessPill status={installation.status} />
                  </div>
                  {installation.error && (
                    <p className="text-destructive mt-2 text-[13px]">
                      {installation.error}
                    </p>
                  )}
                  <PermissionGaps gaps={installation.missingPermissions} />
                  {installation.settingsUrl && (
                    <div className="mt-3 flex gap-2">
                      <ReviewOnGitHub href={installation.settingsUrl} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
