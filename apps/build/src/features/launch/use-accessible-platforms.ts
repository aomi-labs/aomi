"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useGitHubSession } from "@build/components/control-plane/github-session-context";
import { deploymentProjects } from "@build/features/launch/client";
import { DEFAULT_DEPLOY_PLATFORM } from "@build/lib/deploy-platform";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "./query-keys";

export type AccessiblePlatform = {
  name: string;
  projectCount: number;
};

export type AccessiblePlatformsState =
  | { status: "loading" }
  /** Signed out, or the account-wide read failed. Callers fall back to the
   *  typed platform name — a list we could not load must never take away the
   *  entry path that does not depend on it. */
  | { status: "unavailable" }
  | { status: "ready"; platforms: AccessiblePlatform[] };

/**
 * The platforms the signed-in user can reach, derived from the platforms their
 * own projects are bound to.
 *
 * Deliberately not the Manager's `GET /api/platforms`: that one is unauthorized
 * and returns every platform Aomi hosts, which would publish a partner
 * directory. This read is session-scoped, so a user only ever learns the names
 * of platforms whose projects they can already list.
 *
 * It cannot see a platform a partner has named but where the user has no
 * project yet; that case stays on the exact-name entry in
 * {@link PlatformSwitcher}.
 */
export function useAccessiblePlatforms(
  activePlatform?: string | null,
): AccessiblePlatformsState {
  const { account } = useGitHubSession();
  const accountKey = githubAccountKey(account.githubLogin);
  // No platform argument: the unfiltered account-wide list. Same query key the
  // Projects page uses for its unscoped view, so the two share one cache entry
  // instead of racing two identical reads.
  const projects = useQuery({
    queryKey: buildQueryKeys.projects(accountKey ?? "unavailable", undefined),
    queryFn: () => deploymentProjects(),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.projects,
  });

  const active = activePlatform?.trim() || null;

  return useMemo<AccessiblePlatformsState>(() => {
    if (account.loading) return { status: "loading" };
    if (!account.signedIn || !accountKey) return { status: "unavailable" };
    if (projects.isPending) return { status: "loading" };
    if (projects.error) return { status: "unavailable" };

    const counts = new Map<string, number>();
    // Community is always reachable, and the platform you are on has to appear
    // in the list that claims to show where you are — both before either owns
    // a single project.
    counts.set(DEFAULT_DEPLOY_PLATFORM, 0);
    if (active) counts.set(active, counts.get(active) ?? 0);
    for (const project of projects.data?.projects ?? []) {
      const name = project.platformName?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const platforms = [...counts.entries()]
      .map(([name, projectCount]) => ({ name, projectCount }))
      // Community first, then alphabetical: a stable order, so the list does
      // not reshuffle under the cursor as project counts change.
      .sort((left, right) => {
        if (left.name === DEFAULT_DEPLOY_PLATFORM) return -1;
        if (right.name === DEFAULT_DEPLOY_PLATFORM) return 1;
        return left.name.localeCompare(right.name);
      });

    return { status: "ready", platforms };
  }, [
    account.loading,
    account.signedIn,
    accountKey,
    active,
    projects.data,
    projects.error,
    projects.isPending,
  ]);
}
