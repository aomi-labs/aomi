"use client";

// Launch/deployments BFF client — one @aomi-labs/deploy/launch client instance
// bound to Aomi Build's route mounts, re-exported as the named functions the
// call sites (and their test mocks) already use. Only `githubAppInstallUrl`
// leaves the BFF: it reaches the backend through the session-scoped fetch.

import type {
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
} from "@aomi-labs/deploy";
import {
  createLaunchClient,
  LaunchRequestError,
  type GithubAppOAuthStartResponse,
  type GitHubSessionInfo,
  type UserProjectsResult,
} from "@aomi-labs/deploy/launch";
import { sessionScopedFetch } from "@build/lib/settings-api";
import {
  type LaunchActivateResult,
  type LaunchAppStatusesResult,
  type LaunchCreateRepoResult,
  type DeploymentHistoryResult,
  type DeploymentFeedResult,
  type DeploymentSecretsResult,
  type ListDeploymentRecordsResult,
  type DeploymentPromoteResult,
  type DeploymentProjectsResult,
  type LaunchDeployInput,
  type LaunchDeployResult,
  type LaunchPreflightInput,
  type LaunchRedeployResult,
  type LaunchSdkStatus,
  type LaunchStatus,
  type RequiredSecretsResult,
} from "./contracts";

export { LaunchRequestError };
export type { GithubAppOAuthStartResponse };

const client = createLaunchClient({
  backendFetch: sessionScopedFetch,
});

export const githubSigninUrl = client.githubSigninUrl;

export function launchFetchGitHubSession(): Promise<GitHubSessionInfo> {
  return client.fetchGitHubSession();
}

export function launchSignOutGitHub(): Promise<void> {
  return client.signOutGitHub();
}

export function launchProjects(): Promise<UserProjectsResult> {
  return client.projects();
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

export function launchPreflight(
  input: LaunchPreflightInput,
): Promise<LaunchDeployResult> {
  return client.preflight(input);
}

export function launchDeploy(
  input: LaunchDeployInput,
): Promise<LaunchDeployResult> {
  return client.deploy(input);
}

export function launchRedeploy(input: {
  projectId: number;
}): Promise<LaunchRedeployResult> {
  return client.redeploy(input);
}

export function launchCreateRepo(input: {
  platform?: string;
  installationId: string;
  repoName?: string;
}): Promise<LaunchCreateRepoResult> {
  return client.createRepo(input);
}

export function launchStatus(
  deploymentId: string,
  platform?: string,
): Promise<LaunchStatus> {
  return client.status({ deploymentId, platform });
}

export function launchSdkStatus(): Promise<LaunchSdkStatus> {
  return client.sdkStatus();
}

export function deploymentProjects(
  platform?: string,
  projectId?: number,
): Promise<DeploymentProjectsResult> {
  return client.deployments.projects({ platform, projectId });
}

export function deploymentUpgradeSdk(input: {
  projectId: number;
}): Promise<ProjectSdkUpgradeResult> {
  return client.deployments.upgradeSdk(input);
}

export function deploymentSdkStatus(): Promise<LaunchSdkStatus> {
  return client.sdkStatus();
}

export function deploymentSdkUpgradeStatus(input: {
  projectId: number;
}): Promise<ProjectSdkUpgradeStatusResult> {
  return client.deployments.sdkUpgradeStatus(input);
}

export function deploymentHistory(input: {
  projectId: number;
  limit?: number;
}): Promise<DeploymentHistoryResult> {
  return client.deployments.history(input);
}

export function deploymentFeed(input: {
  platform?: string;
  limit?: number;
  cursor?: DeploymentFeedResult["nextCursor"];
}): Promise<DeploymentFeedResult> {
  return client.deployments.feed(input);
}

export function deploymentSecrets(input: {
  applicationId: number;
}): Promise<DeploymentSecretsResult> {
  return client.deployments.secrets(input);
}

export function deploymentRequiredSecrets(input: {
  projectId: number;
}): Promise<RequiredSecretsResult> {
  return client.deployments.requiredSecrets(input);
}

export function deploymentRecords(input: {
  app: string;
  projectId?: number;
  platform?: string;
}): Promise<ListDeploymentRecordsResult> {
  return client.deployments.records(input);
}

export function deploymentPromote(input: {
  deploymentId: string;
  projectId: number;
  apps?: string[];
  actor?: string;
}): Promise<DeploymentPromoteResult> {
  return client.deployments.promote(input);
}

export function launchActivate(input: {
  projectId: number;
  releaseTags: string[];
  apps: string[];
  actor?: string;
}): Promise<LaunchActivateResult> {
  return client.activate(input);
}

export function deploymentDeactivate(input: {
  projectId: number;
  apps: string[];
}): Promise<{ ok: boolean; apps: string[] }> {
  return client.deployments.deactivate(input);
}

export function deploymentSetSecrets(input: {
  applicationId: number;
  secrets: Record<string, string>;
}): Promise<{ ok: boolean; keys: string[] }> {
  return client.deployments.setSecrets(input);
}

export function deploymentDeleteSecret(input: {
  applicationId: number;
  name: string;
}): Promise<{ ok: boolean; removed: boolean }> {
  return client.deployments.deleteSecret(input);
}

export function launchAppsStatus(input: {
  projectId: number;
}): Promise<LaunchAppStatusesResult> {
  return client.appStatuses(input);
}
