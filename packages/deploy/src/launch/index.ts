// Browser-safe project reads and GitHub authentication.

export {
  createLaunchClient,
  isFatalLaunchRequestError,
  isRetryableLaunchError,
  LaunchRequestError,
  DEFAULT_DEPLOYMENTS_BASE_PATH,
  DEFAULT_GITHUB_AUTH_BASE_PATH,
  type LaunchClient,
  type LaunchClientOptions,
  type GitHubSessionInfo,
  type UserProjectsResult,
  type GithubAppOAuthStartResponse,
  type UserProject,
} from "./browser-client";

export type {
  LaunchAgentStatusAgent,
  LaunchAgentStatusesResult,
  DeploymentProjectsResult,
} from "./contracts";
export { platformParam } from "./state";
