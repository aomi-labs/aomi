// GitHub session and Agent client — one @aomi-labs/deploy/launch client instance
// bound to Aomi Build's route mounts, re-exported as the named functions the
// call sites (and their test mocks) already use. Only `githubAppInstallUrl`
// leaves the Build server: the Edge forwards its install start to the backend.

import type { GitHubAppInstallationsResult } from "@aomi-labs/deploy";
import {
  createLaunchClient,
  LaunchRequestError,
  type DeploymentProjectsResult,
  type GithubAppOAuthStartResponse,
  type GitHubSessionInfo,
} from "@aomi-labs/deploy/launch";
import { buildFetch } from "@/lib/session-expiry";

export { LaunchRequestError };
export type { GithubAppOAuthStartResponse };

const client = createLaunchClient({ fetch: buildFetch });

export const githubSigninUrl = client.githubSigninUrl;

export function launchFetchGitHubSession(): Promise<GitHubSessionInfo> {
  return client.fetchGitHubSession();
}

export async function launchSignOutGitHub(): Promise<void> {
  try {
    await client.signOutGitHub();
  } finally {
    // Clear the previous account's wizard state even when sign-out fails.
    try {
      window.localStorage.removeItem("aomi_launch");
    } catch {
      /* Storage may be unavailable. */
    }
  }
}

export function githubAppInstallUrl(args: {
  platform?: string;
  repo?: string;
  app?: number;
  /**
   * Which GitHub ceremony to ask for. The underlying client has always
   * forwarded this; Build's wrapper simply did not expose it, so the one
   * caller that needs `authorize` could not reach it.
   */
  mode?: "install" | "authorize";
  returnTo?: string;
}): Promise<string> {
  return client.githubAppInstallUrl(args);
}

export function deploymentProjects(
  platform?: string,
  projectId?: number,
): Promise<DeploymentProjectsResult> {
  return client.deployments.projects({ platform, projectId });
}

export function deploymentGitHubAppInstallations(): Promise<GitHubAppInstallationsResult> {
  return client.deployments.githubAppInstallations();
}
