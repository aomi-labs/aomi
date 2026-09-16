"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Github, Sparkles } from "lucide-react";
import { Onboarding } from "@build/features/launch/components/onboarding";
import {
  fetchGitHubSession,
  type GitHubSessionInfo,
} from "@build/features/launch/dashboard";
import { loadLaunch } from "@build/features/launch";
import type { NewProjectMode } from "@build/features/launch/new-project-mode";
import { DEFAULT_DEPLOY_PLATFORM } from "@build/lib/deploy-platform";
import { RepositoryConnector } from "./repository-connector";
import { GitHubSignInPanel, LoadingPanel } from "./ui/state-panels";

const HEADLINES: Record<NewProjectMode, string> = {
  template:
    "Fork the template, deploy it, and go live from your GitHub account.",
  import:
    "Connect a repository you already own. Aomi deploys it once GitHub confirms your access.",
};

const CHOICES = [
  {
    key: "template",
    icon: Sparkles,
    title: "Start from the template",
    description:
      "Creates a new repository in your GitHub account from the Aomi template, then builds and deploys it for you.",
  },
  {
    key: "import",
    icon: Github,
    title: "Import from GitHub",
    description:
      "Connects a repository you already have — yours or one a partner shared — and deploys it the same way.",
  },
] as const satisfies readonly {
  key: NewProjectMode;
  icon: typeof Github;
  title: string;
  description: string;
}[];

/** Console-framed create flow. The user picks how to start, then we hand off
 *  to the existing Onboarding wizard (install → create → deploy → activate →
 *  live) or to the repository connector, inside the deployments shell. */
export function NewProject({
  platform,
  backHref = "/operate/deployments",
  backLabel = "Deployments",
  mode: modeParam,
}: {
  platform?: string;
  backHref?: string;
  backLabel?: string;
  /** `?mode=` — set once the user picks a card, so a reload stays put. */
  mode?: NewProjectMode;
}) {
  const [session, setSession] = useState<GitHubSessionInfo | null>(null);
  const [mode, setMode] = useState<NewProjectMode | null>(modeParam ?? null);

  useEffect(() => {
    void fetchGitHubSession()
      .then(setSession)
      .catch(() => setSession({ signedIn: false, githubLogin: null }));
  }, []);

  // A template launch leaves the page entirely for the GitHub install and comes
  // back here. Recognize the return leg so the picker never swallows a launch
  // that is already in flight, even on a link that lost `?mode=`.
  useEffect(() => {
    if (modeParam) return;
    if (resumingTemplate(platform)) setMode("template");
  }, [modeParam, platform]);

  // `?mode=` can change under a mounted component: the App Router reuses this
  // instance across a soft navigation to the same route, so a "New app" link
  // that carries no mode has to return the user to the picker rather than
  // leaving them in the flow they last chose. Only an actual change counts —
  // our own `replaceState` below never re-renders the server component, and
  // reacting on mount would race the resume effect above.
  const lastModeParam = useRef(modeParam);
  useEffect(() => {
    if (lastModeParam.current === modeParam) return;
    lastModeParam.current = modeParam;
    setMode(modeParam ?? null);
  }, [modeParam]);

  // Keep `?mode=` in sync so reload, back/forward, and the GitHub round-trip
  // all return to the card the user chose.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("mode") === (mode ?? null)) return;
    if (mode) url.searchParams.set("mode", mode);
    else url.searchParams.delete("mode");
    window.history.replaceState({}, "", url.toString());
  }, [mode]);

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <Link
            href={backHref}
            className="text-dim hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {backLabel}
          </Link>
          <h1 className="font-display mt-2 text-2xl font-normal tracking-tight">
            New app
          </h1>
          <p className="text-dim mt-1 text-sm">
            {mode
              ? HEADLINES[mode]
              : "Start from the Aomi template, or import a repository you already have."}
          </p>
        </div>

        {session === null ? (
          <Panel>
            <LoadingPanel label="Loading…" />
          </Panel>
        ) : !session.signedIn ? (
          <Panel>
            <GitHubSignInPanel error={null} />
          </Panel>
        ) : mode === null ? (
          <StartPicker onSelect={setMode} />
        ) : (
          <Panel>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="text-dim hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Choose a different start
            </button>
            {mode === "template" ? (
              <Onboarding
                hideWizardBack
                platform={platform}
                sessionInstallationId={session.installationId ?? null}
              />
            ) : (
              <RepositoryConnector
                platform={platform ?? DEFAULT_DEPLOY_PLATFORM}
              />
            )}
          </Panel>
        )}
      </div>
    </main>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="border-border bg-surface-1 rounded-md border p-4 sm:p-6">
      {children}
    </div>
  );
}

function StartPicker({
  onSelect,
}: {
  onSelect: (mode: NewProjectMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="How to start"
      className="grid gap-3 sm:grid-cols-2"
    >
      {CHOICES.map(({ key, icon: Icon, title, description }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className="border-border bg-surface-1 hover:bg-accent-hover hover:border-muted focus-visible:ring-ring group flex flex-col rounded-md border p-4 text-left outline-none transition-colors focus-visible:ring-2"
        >
          <Icon className="text-dim size-4" aria-hidden />
          <div className="text-foreground mt-3 flex items-center gap-1.5 text-sm font-medium">
            {title}
            <ArrowRight
              className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
              aria-hidden
            />
          </div>
          <p className="text-dim mt-1 text-xs leading-5">{description}</p>
        </button>
      ))}
    </div>
  );
}

/**
 * Is a template launch mid-flight? Either the GitHub install redirect is still
 * on the URL, or the saved state says a launch is unfinished: a pending install
 * we navigated away for, or a deployment that has not gone live.
 *
 * The wizard mirrors `deploymentId` into the URL, but only while it is mounted
 * — leaving Build mid-deploy and coming back through the nav arrives with a
 * clean URL, so the check has to reach into storage too.
 *
 * A stale `installationId` deliberately does not count, and neither does a
 * launch already `live`: both survive a finished run, and either one would pin
 * every later visit to the template card instead of offering the choice.
 */
function resumingTemplate(platform?: string): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has("installation_id") || params.has("deployment_id")) return true;
  if (params.get("launch") === "personal_required") return true;
  const saved = loadLaunch(platform ?? DEFAULT_DEPLOY_PLATFORM);
  if (saved.pendingInstall) return true;
  return Boolean(saved.oneshot.deploymentId) && !saved.oneshot.live;
}
