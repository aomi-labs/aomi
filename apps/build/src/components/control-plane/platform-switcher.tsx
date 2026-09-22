"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers3, LoaderCircle } from "lucide-react";

import { useGitHubSession } from "@build/components/control-plane/github-session-context";
import { HelpBadge } from "@build/components/help-badge";
import {
  deploymentProjects,
  LaunchRequestError,
} from "@build/features/launch/client";
import {
  buildQueryKeys,
  githubAccountKey,
} from "@build/features/launch/query-keys";
import { writePlatform } from "@build/features/launch/platform";
import { usePlatform } from "@build/features/launch/use-platform";
import {
  useAccessiblePlatforms,
  type AccessiblePlatform,
} from "@build/features/launch/use-accessible-platforms";
import { DEFAULT_DEPLOY_PLATFORM } from "@build/lib/deploy-platform";
import { cn } from "@build/lib/utils";

function projectCountLabel(count: number) {
  if (count === 0) return "No projects yet";
  return count === 1 ? "1 project" : `${count} projects`;
}

export function PlatformSwitcher({
  currentPlatform,
}: {
  currentPlatform?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stored = usePlatform();
  // Settings has no `?platform=`, so without the persisted selection this
  // would always render empty and never show which platform you are on.
  const activePlatform =
    currentPlatform === undefined
      ? searchParams.get("platform")?.trim() || stored
      : currentPlatform;
  const queryClient = useQueryClient();
  const { account } = useGitHubSession();
  const accessible = useAccessiblePlatforms(activePlatform);
  const [value, setValue] = useState(activePlatform ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(activePlatform ?? "");
    setError(null);
  }, [activePlatform]);

  function goToPlatform(platform: string) {
    writePlatform(platform);
    router.push(`/projects?platform=${encodeURIComponent(platform)}`);
  }

  /** A name that came out of an authorized read of the user's own projects is
   *  already known-good; re-verifying it would only add latency and a second
   *  way to fail. */
  function select(platform: string) {
    if (checking || platform === activePlatform) return;
    setValue(platform);
    setError(null);
    goToPlatform(platform);
  }

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
      goToPlatform(platform);
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

  return (
    <div className="w-full">
      {accessible.status === "loading" ? (
        <ul aria-hidden className="mb-8 space-y-2">
          {[0, 1].map((row) => (
            <li
              key={row}
              className="border-border h-[62px] w-full rounded-xl border"
            />
          ))}
        </ul>
      ) : null}

      {accessible.status === "ready" ? (
        <ul aria-label="Your platforms" className="mb-8 space-y-2">
          {accessible.platforms.map((platform) => (
            <PlatformRow
              key={platform.name}
              platform={platform}
              current={platform.name === activePlatform}
              disabled={checking}
              onSelect={() => select(platform.name)}
            />
          ))}
        </ul>
      ) : null}

      <p className="text-subtle mb-3 text-[13px]">
        On a platform that is not listed? Enter its exact name.
      </p>
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
    </div>
  );
}

function PlatformRow({
  platform,
  current,
  disabled,
  onSelect,
}: {
  platform: AccessiblePlatform;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const isCommunity = platform.name === DEFAULT_DEPLOY_PLATFORM;
  return (
    <li>
      <div
        className={cn(
          "border-border flex items-center gap-3 rounded-xl border px-4 py-3 transition",
          current && "border-foreground/30 bg-accent",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || current}
          aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <Layers3 className="text-dim size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="text-foreground block truncate text-[13px] font-medium">
              {platform.name}
            </span>
            <span className="text-dim block text-xs">
              {projectCountLabel(platform.projectCount)}
            </span>
          </span>
        </button>
        {isCommunity ? (
          <HelpBadge label="What is Community?">
            Community is Aomi&apos;s default platform for projects that are not
            scoped to a partner deployment.
          </HelpBadge>
        ) : null}
        {current ? (
          <span className="text-foreground inline-flex shrink-0 items-center gap-1 text-xs">
            <Check className="size-3.5" aria-hidden />
            Current
          </span>
        ) : null}
      </div>
    </li>
  );
}
