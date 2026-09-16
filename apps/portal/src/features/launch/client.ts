"use client";

// Portal and Build share the same browser launch client. The host-specific
// session fetcher is the only difference; route contracts, error handling, and
// project-scoped status calls stay in @aomi-labs/deploy/launch.

import {
  createLaunchClient,
  LaunchRequestError,
  type GithubAppOAuthStartResponse,
  type GitHubSessionInfo,
  type UserProjectsResult,
} from "@aomi-labs/deploy/launch";
import { sessionScopedFetch } from "@portal/lib/settings-api";
import type {
  LaunchActivateResult,
  LaunchAppStatusesResult,
  LaunchCreateRepoResult,
  DeploymentHistoryResult,
  DeploymentSecretsResult,
  ListDeploymentRecordsResult,
  DeploymentPromoteResult,
  DeploymentProjectsResult,
  LaunchDeployInput,
  LaunchDeployResult,
  LaunchPreflightInput,
  LaunchRedeployResult,
  LaunchSdkStatus,
  LaunchStatus,
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
  mode?: "install" | "authorize";
  app?: number;
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

export function deploymentSdkStatus(): Promise<LaunchSdkStatus> {
  return client.sdkStatus();
}

export function deploymentHistory(input: {
  projectId: number;
  limit?: number;
}): Promise<DeploymentHistoryResult> {
  return client.deployments.history(input);
}

export function deploymentSecrets(input: {
  applicationId: number;
}): Promise<DeploymentSecretsResult> {
  return client.deployments.secrets(input);
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
