"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Layers3, LoaderCircle } from "lucide-react";

import { useGitHubSession } from "@/components/control-plane/github-session-context";
import { HelpBadge } from "@/components/help-badge";
import {
  deploymentProjects,
  LaunchRequestError,
} from "@/features/deploy/client";
import { buildQueryKeys, githubAccountKey } from "@/features/deploy/query-keys";
import { writePlatform } from "@/features/deploy/platform";
import { usePlatform } from "@/features/deploy/use-platform";
import { DEFAULT_DEPLOY_PLATFORM } from "@/lib/deploy-platform";

export function PlatformSwitcher({
  currentPlatform,
}: {
  currentPlatform?: string | null;
}) {
  const router = useRouter();
  const searchParams = new URLSearchParams(
    useLocation({ select: (location) => location.searchStr }),
  );
  const stored = usePlatform();
  // Settings has no `?platform=`, so without the persisted selection this
  // would always render empty and never show which platform you are on.
  const activePlatform =
    currentPlatform === undefined
      ? searchParams.get("platform")?.trim() || stored
      : currentPlatform;
  const queryClient = useQueryClient();
  const { account } = useGitHubSession();
  const [value, setValue] = useState(activePlatform ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(activePlatform ?? "");
    setError(null);
  }, [activePlatform]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const platform = value.trim();
    if (!platform || checking) return;
    if (!account.signedIn) {
      setError("Sign in with GitHub before switching platforms.");
      return;
    }
    if (platform === activePlatform) {
      setError(null);
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const result = await deploymentProjects(platform);
      const accountKey = githubAccountKey(account.githubLogin);
      if (accountKey) {
        queryClient.setQueryData(
          buildQueryKeys.projects(accountKey, platform),
          result,
        );
        // The platform we are leaving keeps a cache entry that is now stale
        // for anyone who switches back.
        if (activePlatform) {
          queryClient.invalidateQueries({
            queryKey: buildQueryKeys.projects(accountKey, activePlatform),
          });
        }
      }
      writePlatform(platform);
      router.navigate({
        href: `/projects?platform=${encodeURIComponent(platform)}`,
      });
    } catch (cause) {
      setError(
        cause instanceof LaunchRequestError &&
          (cause.status === 400 || cause.status === 404)
          ? "Platform not found. Nothing changed—check the exact name and try again."
          : "We couldn’t verify that platform. Nothing changed—try again.",
      );
    } finally {
      setChecking(false);
    }
  }

  function useCommunity() {
    if (checking) return;
    setValue(DEFAULT_DEPLOY_PLATFORM);
    setError(null);
    writePlatform(DEFAULT_DEPLOY_PLATFORM);
    router.navigate({
      href: `/projects?platform=${encodeURIComponent(DEFAULT_DEPLOY_PLATFORM)}`,
    });
  }

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex items-center gap-3">
        <div className="border-border bg-background focus-within:ring-ring flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full border px-4 focus-within:ring-1">
          {checking ? (
            <LoaderCircle
              className="text-dim size-3.5 shrink-0 animate-spin"
              aria-hidden
            />
          ) : (
            <Layers3 className="text-dim size-3.5 shrink-0" aria-hidden />
          )}
          <input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            disabled={checking || account.loading}
            aria-label="Platform name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "platform-switch-error" : undefined}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="Platform name"
            style={{ outline: "none" }}
            className="text-foreground placeholder:text-dim min-w-0 flex-1 bg-transparent text-[13px] disabled:cursor-wait"
          />
        </div>
        <button
          type="submit"
          disabled={!value.trim() || checking || account.loading}
          className="bg-primary text-primary-foreground hover:bg-brand-hover inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? "Checking…" : "Switch"}
        </button>
      </form>
      {error ? (
        <p
          id="platform-switch-error"
          role="alert"
          className="text-negative mt-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      <div className="border-border mt-8 flex items-center justify-between gap-4 border-t pt-6">
        <div className="flex min-w-0 items-center gap-1">
          <p className="text-foreground text-[13px] font-medium">Community</p>
          <HelpBadge label="What is Community?">
            Community is Aomi&apos;s default platform for projects that are not
            scoped to a partner deployment.
          </HelpBadge>
        </div>
        <button
          type="button"
          onClick={useCommunity}
          disabled={checking}
          className="border-border hover:bg-accent-hover text-foreground inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use Community
        </button>
      </div>
    </div>
  );
}
