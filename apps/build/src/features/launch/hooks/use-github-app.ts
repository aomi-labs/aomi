"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GitHubAppInstallationsResult } from "@aomi-labs/deploy";
import { useGitHubSession } from "@build/components/control-plane/github-session-context";
import { deploymentGitHubAppInstallations } from "@build/features/launch/client";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "../query-keys";

export type GitHubAppState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; report: GitHubAppInstallationsResult }
  | { status: "error"; error: string };

export function useGitHubAppInstallations(platform?: string) {
  // Same shell-level session as the project list: no second status fetch.
  const { account } = useGitHubSession();
  const accountKey = githubAccountKey(account.githubLogin);
  const report = useQuery({
    queryKey: buildQueryKeys.githubApp(accountKey ?? "unavailable", platform),
    queryFn: () => deploymentGitHubAppInstallations(platform),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.githubApp,
  });

  const state = useMemo<GitHubAppState>(() => {
    if (account.loading) return { status: "loading" };
    if (!account.signedIn) return { status: "signed_out" };
    if (!accountKey) {
      return { status: "error", error: "GitHub account login is missing" };
    }
    if (report.error) {
      const message =
        report.error instanceof Error
          ? report.error.message
          : "Failed to load GitHub App access";
      if (message.toLowerCase().includes("not signed in with github")) {
        return { status: "signed_out" };
      }
      return { status: "error", error: message };
    }
    if (!report.data) return { status: "loading" };
    return { status: "ready", report: report.data };
  }, [account, accountKey, report.data, report.error]);

  const refetch = useCallback(() => {
    void report.refetch();
  }, [report]);

  return { state, refetch, refetching: report.isFetching };
}
