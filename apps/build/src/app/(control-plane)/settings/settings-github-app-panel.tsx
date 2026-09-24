"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import type {
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
  "border-border hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium disabled:opacity-50";

const accessLabel: Record<PlatformInstallationStatusKind, string> = {
  ok: "Access OK",
  missing_permissions: "Permissions missing",
  suspended: "Suspended",
  not_installed: "Not installed",
  error: "Check failed",
};

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

export function SettingsGitHubAppPanel() {
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
            Check that the selected platform&apos;s deployment repository grants
            the GitHub App the access needed to publish and run deployments.
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
      {state.status === "ready" && !state.report.platform && (
        <p className="text-dim text-sm">
          Select a deployment platform above to check its GitHub App access.
        </p>
      )}
      {state.status === "ready" && state.report.platform && (
        <div className="border-border bg-surface-1 max-w-2xl rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-foreground min-w-0 truncate text-sm font-medium">
              <span className="font-mono">
                {state.report.platform.githubRepo}
              </span>
            </div>
            <span
              className={`inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] ${
                state.report.platform.status === "ok"
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : state.report.platform.status === "missing_permissions" ||
                      state.report.platform.status === "not_installed"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {accessLabel[state.report.platform.status]}
            </span>
          </div>
          <p className="text-dim mt-2 text-[13px]">
            {state.report.platform.status === "not_installed"
              ? "The GitHub App is not installed on this repository."
              : state.report.platform.status === "suspended"
                ? "This GitHub App installation is suspended."
                : state.report.platform.status === "error"
                  ? "GitHub App access could not be checked."
                  : `Deploys need ${Object.entries(
                      state.report.platform.required,
                    )
                      .map(([name, level]) => `${name}: ${level}`)
                      .join(", ")} on this repository.`}
          </p>
          {state.report.platform.installation && (
            <>
              <PermissionGaps
                gaps={state.report.platform.installation.missingPermissions}
              />
              {state.report.platform.installation.settingsUrl && (
                <a
                  className={`${button} mt-3`}
                  href={state.report.platform.installation.settingsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Review on GitHub
                  <ExternalLink className="size-3" />
                </a>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
