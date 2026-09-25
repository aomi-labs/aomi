"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock, Github } from "lucide-react";
import { githubAppInstallUrl } from "@build/features/launch/client";
import { normalizeRepo } from "@build/features/launch/state";
import type { RepositoryConnectionResult } from "@aomi-labs/deploy/launch";

export type { RepositoryConnectionResult };

/**
 * The outcome of a GitHub round-trip, rendered on its own.
 *
 * The connect form lives on the "New app" page, but GitHub returns the user to
 * the scoped Projects page — where the new project is — so the result has to be
 * renderable without the form that started it.
 */
export function ConnectionResultBanner({
  platform,
  result,
}: {
  platform: string;
  result?: RepositoryConnectionResult;
}) {
  if (!result) return null;

  if (result.status === "success") {
    return (
      <div
        role="status"
        className="border-border bg-surface-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      >
        <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
        <span>
          {result.repo ?? "Repository"} is now connected to {platform}.
        </span>
      </div>
    );
  }

  if (result.status === "pending") {
    return (
      <div
        role="status"
        className="border-border bg-surface-1 text-dim flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      >
        <Clock className="size-4 shrink-0" aria-hidden />
        <span>{result.message}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      <span>{result.message}</span>
    </div>
  );
}

export function RepositoryConnector({
  platform,
  result,
  navigate = (url) => window.location.assign(url),
}: {
  platform: string;
  result?: RepositoryConnectionResult;
  navigate?: (url: string) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const repo = normalizeRepo(input);
    if (!repo) {
      setError("Enter a GitHub repository as owner/name.");
      return;
    }

    setError(null);
    setConnecting(true);
    try {
      const returnTo = `${window.location.origin}/projects?platform=${encodeURIComponent(platform)}`;
      navigate(await githubAppInstallUrl({ platform, repo, returnTo }));
    } catch (cause) {
      // A navigation never resolves a React lifecycle. Keep the control busy
      // until the browser leaves this document; only a failed hand-off makes
      // retrying meaningful.
      setConnecting(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start GitHub authorization.",
      );
    }
  }

  return (
    <section aria-labelledby="connect-repository-title" className="space-y-3">
      <div>
        <h2 id="connect-repository-title" className="text-sm font-medium">
          Connect an existing repository
        </h2>
        <p className="text-dim mt-1 text-sm">
          Enter the GitHub repository you already own. If access is needed,
          GitHub will ask you to select this repository before it is added to{" "}
          <span className="text-foreground">{platform}</span>.
        </p>
      </div>

      <ConnectionResultBanner platform={platform} result={result} />

      <form onSubmit={connect} className="flex max-w-2xl gap-2">
        <div className="relative min-w-0 flex-1">
          <Github
            className="text-dim pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            aria-label="GitHub repository"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="owner/repository"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="border-border bg-background placeholder:text-dim focus:border-muted h-9 w-full rounded-md border pl-9 pr-3 text-sm outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={connecting || !input.trim()}
          className="bg-primary text-primary-foreground inline-flex h-9 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect repository"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
