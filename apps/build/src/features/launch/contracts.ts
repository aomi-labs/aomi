// Launch contracts — the shapes live in @aomi-labs/deploy/launch; this module
// keeps the app-local import path stable and pins the app's template-repo
// choice (env-resolved once at module load, as before).
import {
  resolveTemplateRepo,
  templateGenerateUrl,
  templateRepoUrl,
} from "@aomi-labs/deploy/launch";

export type {
  DeploymentRecord,
  ListDeploymentRecordsResult,
} from "@aomi-labs/deploy";

export type {
  LaunchPath,
  LaunchDeployPayload,
  LaunchProgress,
  LaunchPreflightInput,
  LaunchDeployInput,
  LaunchDeployResult,
  LaunchCreateRepoResult,
  LaunchStatus,
  LaunchActivateResult,
  LaunchAppStatusesResult,
  LaunchRedeployResult,
  LaunchSdkStatus,
  DeploymentProjectsResult,
  DeploymentHistoryResult,
  DeploymentFeedResult,
  DeploymentSecretsResult,
  DeploymentPromoteResult,
  RequiredSecretsResult,
} from "@aomi-labs/deploy/launch";

export const TEMPLATE_REPO = resolveTemplateRepo();
export const TEMPLATE_REPO_URL = templateRepoUrl(TEMPLATE_REPO);
export const TEMPLATE_GENERATE_URL = templateGenerateUrl(TEMPLATE_REPO);
