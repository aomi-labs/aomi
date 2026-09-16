"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@aomi-labs/widget-lib";
import {
  installationStatusLabel,
  launchCreateRepo,
  oneshotStep,
  TEMPLATE_REPO,
  type LaunchProgress,
} from "@build/features/launch";
import { chatAppUrl } from "@build/lib/chat-url";
import { Stepper } from "./stepper";
import Link from "next/link";
import { LivePanel } from "./live-panel";

const STEPS = [
  { key: "install", label: "Install" },
  { key: "create", label: "Create" },
  { key: "build", label: "Configure" },
  { key: "live", label: "Live" },
];

const DEFAULT_REPO_NAME = "my-aomi-playground";

function repoNameError(value: string): string | null {
  const repo = value.trim();
  if (!repo) return "Repo name is required.";
  if (repo.length > 100) return "Repo name must be 100 characters or less.";
  if (repo === "." || repo === ".." || repo.includes("..")) {
    return "Repo name cannot be . or .. or contain consecutive dots.";
  }
  if (repo.includes("/") || repo.endsWith(".git")) {
    return "Enter only the repo name, not a GitHub URL.";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) {
    return "Use letters, numbers, dots, underscores, or hyphens.";
  }
  return null;
}

export function OneshotWizard({
  progress,
  platform,
  onRestart,
  beginInstall,
  installing,
  installError,
  patch,
  onInstallRejected,
}: {
  progress: LaunchProgress;
  platform?: string;
  onRestart?: () => void;
  /**
   * Send the browser to GitHub. `authorize` skips the install ceremony for an
   * account that already has the App — see the Install step below.
   */
  beginInstall: (mode?: "install" | "authorize") => void;
  installing?: boolean;
  installError?: string | null;
  patch: (patch: Partial<LaunchProgress>) => void;
  onInstallRejected?: (installationId?: string) => void;
}) {
  const step =
    progress.projectId && progress.repo && !progress.live
      ? "build"
      : oneshotStep(progress);
  const installStatus = installationStatusLabel(progress.installationStatus);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState(DEFAULT_REPO_NAME);
  const repoError = repoNameError(repoName);

  const createRepo = async () => {
    if (!progress.installationId || repoError) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await launchCreateRepo({
        installationId: progress.installationId,
        repoName: repoName.trim(),
        platform,
      });
      patch({
        installationId: result.installationId,
        repo: result.repo,
        projectId: result.projectId,
        sourceRef: result.sourceRef,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCreateError(message);
      // A skip-install installation can go stale (uninstalled, wrong account,
      // permissions revoked). If create blames the installation, drop it so the
      // wizard falls back to the install step and the user can re-authorize
      // instead of being stuck retrying against a dead installation. Recording
      // it as rejected also stops it being re-seeded from the session cookie.
      if (isInstallationError(message)) {
        if (onInstallRejected) onInstallRejected(progress.installationId);
        else patch({ installationId: undefined });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <WizardHeader
        title="Deploy your agent"
        subtitle="We create the repo and deploy it for you."
        actionLabel={
          progress.installationId || progress.repo ? "Start over" : undefined
        }
        onAction={onRestart}
      />

      <Stepper
        steps={STEPS}
        current={step}
        activeBusy={installing || creating}
      />

      {/* completed-fact summary */}
      {(progress.installationId || progress.repo) && (
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {progress.installationId && (
            <span>
              installation{" "}
              <code className="text-foreground">{progress.installationId}</code>
            </span>
          )}
          {installStatus && <span>{installStatus}</span>}
          {progress.repo && (
            <span>
              repo <code className="text-foreground">{progress.repo}</code>
            </span>
          )}
        </div>
      )}

      {step === "install" && (
        <div className="space-y-3">
          <div className="border-input bg-surface-1 space-y-3 rounded-md border p-4">
            <div className="text-foreground text-sm font-medium">
              Step 1: Install the Aomi GitHub App
            </div>
            <p className="text-muted-foreground text-sm leading-5">
              Installs <code>aomi-build-oneshot</code>. It can create a repo in
              your account from our template and open deploy pull requests.
              You&apos;ll return here automatically after consent.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => beginInstall("install")}
                disabled={installing}
                className="h-9 rounded-md px-3 text-sm font-medium"
              >
                {installing ? "Waiting for GitHub..." : "Install on GitHub"}
                <ExternalLink className="ml-1 h-4 w-4" />
              </Button>
              {/*
                GitHub does not re-run an install for an account that already
                has one — it renders the App's configure page, which never
                redirects back here, so "Install on GitHub" is a dead end for
                anyone already installed. This asks for the OAuth consent leg
                instead, which does return with an installation id.
              */}
              <Button
                onClick={() => beginInstall("authorize")}
                disabled={installing}
                className="bg-surface-2 text-foreground h-9 rounded-md px-3 text-sm font-medium"
              >
                Already installed — continue
                <ExternalLink className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
          <WizardError message={installError ?? createError} />
        </div>
      )}

      {step === "create" && progress.installationId && (
        <div className="space-y-3">
          <div className="border-input bg-surface-1 space-y-3 rounded-md border p-4">
            <div className="text-foreground text-sm font-medium">
              Step 2: Create your repo
            </div>
            <p className="text-muted-foreground text-sm leading-5">
              Creates a GitHub repo from <code>{TEMPLATE_REPO}</code> in the
              account where you installed <code>aomi-build-oneshot</code>.
            </p>
            <label className="block space-y-1.5">
              <span className="text-foreground text-xs font-medium">
                Repo name
              </span>
              <input
                value={repoName}
                onChange={(event) => {
                  setRepoName(event.target.value);
                  setCreateError(null);
                }}
                disabled={creating}
                className="border-input bg-background text-foreground focus-visible:ring-ring h-10 w-full max-w-sm rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
                placeholder={DEFAULT_REPO_NAME}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {repoError && (
              <div className="text-destructive text-xs">{repoError}</div>
            )}
            <Button
              onClick={createRepo}
              disabled={creating || Boolean(repoError)}
              className="h-9 rounded-md px-3 text-sm font-medium"
            >
              {creating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              Create repo
            </Button>
          </div>
          <WizardError message={createError} />
        </div>
      )}

      {step === "build" && progress.installationId && progress.repo && (
        <div className="border-input bg-surface-1 space-y-3 rounded-md border p-4">
          <div className="text-foreground text-sm font-medium">
            Step 3: Configure deployment
          </div>
          <p className="text-dim text-sm">
            Review the repository, branch, and required configuration, then
            choose Deploy. Progress and retries stay on your project.
          </p>
          {progress.projectId ? (
            <Link
              className="bg-primary text-primary-foreground inline-flex rounded-md px-3 py-2 text-sm"
              href={`/projects/${progress.projectId}?tab=deployments&platform=${encodeURIComponent(platform ?? "community")}`}
            >
              Configure deployment
            </Link>
          ) : (
            <p role="alert">
              Project details are unavailable. Refresh Projects to reconnect
              this repository.
            </p>
          )}
        </div>
      )}

      {step === "live" && (
        <LivePanel
          repo={progress.repo}
          chatUrl={
            progress.apps?.[0]
              ? chatAppUrl(progress.apps[0], {
                  locked: true,
                  applicationId: progress.applicationId,
                })
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * Does this create error point at the GitHub App installation (removed, wrong
 * account, missing permissions) rather than something transient like a repo
 * name clash? If so the wizard should drop the cached installation and send the
 * user back to install/re-authorize.
 */
function isInstallationError(message: string): boolean {
  return /install|not owned|permission|forbidden|\b404\b|not found/i.test(
    message,
  );
}

function WizardError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p className="mt-3 break-words rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
      {message}
    </p>
  );
}

function WizardHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-foreground text-2xl font-normal tracking-tight">
          {title}
        </h1>
        {actionLabel && onAction && (
          <Button
            onClick={onAction}
            className="h-9 max-w-full rounded-md px-3 text-sm font-medium"
          >
            <RotateCcw className="mr-1 h-4 w-4 shrink-0" />
            {actionLabel}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{subtitle}</p>
    </header>
  );
}

export { WizardHeader, WizardError };
