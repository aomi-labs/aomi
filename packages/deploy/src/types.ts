// =============================================================================
// Public input types for the repo-scoped platform deploy contract. Response
// types are inferred from the schemas in ./schemas.
// =============================================================================

import type {
  ActivateResult,
  DeploymentRecord,
  DeploymentStatus,
  OperateLogCursor,
  OperateTransactionCursor,
  SecretSlot,
  UserDeploymentsCursor,
} from "./schemas";

export type * from "./schemas";

export interface IngestSecretsInput {
  applicationId: number;
  app: string;
  secrets: Record<string, string>;
}

export interface ListAppSecretsInput {
  applicationId: number;
}

export interface RemoveAppSecretInput {
  applicationId: number;
  name: string;
}

export interface SdkVersionStatus {
  requiredVersion: string;
  projectVersion?: string | null;
  lockfileVersion?: string | null;
  cliVersion?: string | null;
  status: "unknown" | "matching" | "outdated" | "loose" | "missing";
  fixCommand?: string | null;
}

/** Immutable git commit SHA accepted by the platform deploy backend. */
export type SourceRef = string;

export interface DeployInput {
  /** Platform-bound project selected for this deploy. */
  projectId: number;
  sourceRef: SourceRef;
  actor?: string;
}

export interface PreflightInput extends Omit<DeployInput, "sourceRef"> {
  /** Omit to preflight the project's current default head. */
  sourceRef?: SourceRef;
}

export interface StatusInput {
  platform: string;
  /** Deployment ID to poll `/api/platforms/:platform/deployments/:id/status`. */
  deploymentId?: string;
  /** Optional owner filter for deployment status reads made from Aomi Build. */
  githubUserId?: string;
  /** Optional backend status path. Defaults to `/api/platforms/:platform/status`. */
  path?: string;
  actor?: string;
}

/** Structured progress value emitted with every DeploymentProgressEvent. */
export interface ProgressModel {
  /** 0–total */
  completed: number;
  /** total steps (>0) */
  total: number;
  /** human-readable phase label, e.g. "Building CI (2/5)" */
  label: string;
}

export type DeploymentEventKind =
  | "progress" // normal polling tick
  | "terminal" // ready or failed — polling will stop
  | "warning" // transient polling failure, will retry
  | "error"; // polling stopped due to exhaustion/timeout/cancellation/non-retryable

export interface DeploymentProgressEvent {
  kind: DeploymentEventKind;
  status: DeploymentStatus;
  progress: ProgressModel;
  /** Only set when kind === "error" || kind === "warning" */
  error?: Error;
}

export interface WatchDeploymentOptions {
  /** Polling interval for the first tick (ms). Default: 3000 */
  baseDelayMs?: number;
  /** Maximum polling interval after backoff (ms). Default: 30000 */
  maxDelayMs?: number;
  /** Maximum number of consecutive failures before emitting error event. Default: 8 */
  maxRetries?: number;
  /** AbortSignal to cancel the watch loop externally. */
  signal?: AbortSignal;
}

export interface ScaffoldInput {
  platform: string;
  installationId: number;
  /** New repo name created in the installation's account from the template. */
  repoName: string;
  /** Template `owner/repo` to copy for the one-shot flow. */
  templateRepo: string;
  /**
   * GitHub user the created project is owned by. Written onto the project row
   * at insert so it appears on the developer's dashboard immediately. Supplied
   * by the portal BFF from the signed-in GitHub session.
   */
  githubUserId: string;
  /** Create the new repo private. Defaults to false. */
  private?: boolean;
}

export interface ExchangeGitHubCodeInput {
  /** GitHub OAuth authorization code from the sign-in redirect. */
  code: string;
  /** Which configured GitHub App (1 = build, 2 = oneshot). */
  app?: number;
  /** Redirect URI used when the authorization code was issued. */
  redirectUri?: string;
}

export interface ClaimGitHubProjectInput {
  code: string;
  projectId: number;
  redirectUri?: string;
}

export interface ListUserProjectsInput {
  githubUserId: string;
  platform?: string;
  visibilityGrant?: string;
}

/**
 * Structured failure detail the Manager attaches to a deploy-domain error
 * (`deploy_error` on the wire). Internal message/details are deliberately not
 * exposed through the BFF.
 */
export interface DeployErrorDetail {
  code: string;
  hint: string | null;
  retryable: boolean;
}

export interface GetUserProjectInput {
  githubUserId: string;
  projectId: number;
  visibilityGrant?: string;
}

export interface GetBuilderApplicationInput {
  githubUserId: string;
  applicationId: number;
}

export interface BuilderAppKeyInput extends GetBuilderApplicationInput {
  actor?: string;
}

export interface ListUserProjectDeploymentsInput {
  githubUserId: string;
  projectId: number;
  limit?: number;
}

/** Exact candidate projection; unlike the paged history this is safe for
 * authorization and for a deployment's first promotion. */
export interface GetUserProjectDeploymentInput {
  githubUserId: string;
  projectId: number;
  deploymentId: string;
}

export interface PromoteUserProjectDeploymentInput extends GetUserProjectDeploymentInput {
  mode: "targeted" | "apply_composition";
  apps?: string[];
  actor?: string;
}

export interface ActivateUserProjectReleasesInput {
  githubUserId: string;
  projectId: number;
  releaseTags: string[];
  apps: string[];
  actor?: string;
}

export interface ListUserDeploymentsInput {
  githubUserId: string;
  platform?: string;
  limit?: number;
  cursor?: UserDeploymentsCursor | null;
}

export interface ListDeploymentRecordsInput {
  platform: string;
  app: string;
  /** Disambiguates same-named apps across projects on one platform. */
  projectId?: number;
}

export interface DeactivateApplicationInput {
  platform: string;
  applicationId: number;
  app?: string;
  actor?: string;
}

export interface ListDeploymentRecordsResult {
  app: string;
  currentReleaseTag: string | null;
  records: DeploymentRecord[];
}

/** Project-scoped read: the backend derives the bound platform from the
 *  project row — callers never supply one. */
export interface OwnedOperateProjectInput {
  githubUserId: string;
  projectId: number;
}

/** Account-wide observability batch: the manager reports every owned project
 *  under its own bound platform. */
export interface GetUserObservabilityInput {
  githubUserId: string;
  /** Optional project narrowing for an observability deep link. */
  projectId?: number;
}

/** Account-wide operate batch reads (`/user/transactions|statement|usage|logs`).
 *  The manager reads every owned project under its own bound platform —
 *  partner-bound projects included. */
export interface UserOperateBatchInput {
  githubUserId: string;
}

export interface GetUserStatementsInput extends UserOperateBatchInput {
  fromDate?: string;
  toDate?: string;
}

export interface ListUserTransactionsInput extends UserOperateBatchInput {
  cursor?: OperateTransactionCursor | string | null;
  limit?: number;
  status?: string;
}

export interface ListUserLogsInput extends UserOperateBatchInput {
  cursor?: OperateLogCursor | string | null;
  limit?: number;
  type?: "deployment" | "usage" | "transaction" | string;
}

export interface ListUserProjectTransactionsInput extends OwnedOperateProjectInput {
  cursor?: OperateTransactionCursor | string | null;
  limit?: number;
  status?: string;
}

export interface GetUserProjectUsageInput extends OwnedOperateProjectInput {
  fromDate?: string;
  toDate?: string;
}

export interface ListUserProjectLogsInput extends OwnedOperateProjectInput {
  cursor?: OperateLogCursor | string | null;
  limit?: number;
  type?: "deployment" | "usage" | "transaction" | string;
}

export interface BuilderBotsInput {
  githubUserId: string;
}

export interface CreateUserBotInput extends BuilderBotsInput {
  applicationIds: number[];
  handoverApplicationId: number;
  botPlatform: string;
  credential: string;
  label?: string;
  threadMode?: string;
  /** Omitted = no Mini App; null or "" clears. */
  miniAppUrl?: string | null;
  /** Omitted = "Open"; null or "" clears. */
  miniAppLabel?: string | null;
  /** Omitted = custom commands unsupported; null or "" clears. */
  commandEndpoint?: string | null;
  commands?: string[];
}

export interface UpdateUserBotInput extends BuilderBotsInput {
  botId: string;
  applicationIds: number[];
  handoverApplicationId: number;
  /** Omitted = unchanged; blank clears the label (manager semantics). */
  label?: string;
  /** Omitted = unchanged; "single" | "multi". */
  threadMode?: string;
  /** Omitted = unchanged; null or "" clears. */
  miniAppUrl?: string | null;
  /** Omitted = unchanged; null or "" clears. */
  miniAppLabel?: string | null;
  /** Omitted = unchanged; null or "" clears. */
  commandEndpoint?: string | null;
  /** Omitted = unchanged; [] clears. */
  commands?: string[];
}

export interface RevealUserBotCommandSecretInput extends BuilderBotsInput {
  botId: string;
}

export interface CheckUserBotWebhookInput extends BuilderBotsInput {
  botId: string;
}

export interface DeleteUserBotInput extends BuilderBotsInput {
  botId: string;
}

export interface BuilderModelKeysInput {
  githubUserId: string;
  platform: string;
}

/** Create (no keyId) or rotate (keyId set) a builder model key. `key` is the
 *  raw material; never stored client-side, logged, or returned. */
export interface SaveBuilderModelKeyInput extends BuilderModelKeysInput {
  keyId?: number;
  /** "openai" | "anthropic" | "openrouter". */
  provider: string;
  key: string;
  label?: string;
}

export interface DeleteBuilderModelKeyInput extends BuilderModelKeysInput {
  keyId: number;
}

/** Replace a key's grant set ("apply to projects"). */
export interface SetModelKeyGrantsInput extends BuilderModelKeysInput {
  keyId: number;
  applicationIds: number[];
  modelIds: "*" | string[];
}

// =============================================================================
// Deployment-management surface. These types are shared by the standalone
// dashboard/TUI work while the current launch routes remain compatible.
// =============================================================================

export interface PromoteInput {
  platform: string;
  deploymentId: string;
  apps?: string[];
  targetTags?: string[];
  actor?: string;
}

export interface PromoteResult {
  ok: boolean;
  promote: {
    deploymentId: string;
    releaseTags: string[];
    status: "promoted" | "blocked" | "awaiting_review" | string;
    sdkStatus?: SdkVersionStatus | null;
    activation?: ActivateResult["activation"];
  };
}

export interface ReleaseManifestPlugin {
  file: string;
  sha256: string;
  secrets?: SecretSlot[];
}

/** The `manifest.json` asset published with every plugin release. */
export interface ReleaseManifest {
  app_release_tag: string;
  sdk_version: string;
  target: string;
  commit: string;
  plugins: Record<string, ReleaseManifestPlugin>;
}

export interface RerunDeploymentInput {
  platform: string;
  deploymentId: string;
  /** Optional owner filter enforced by the backend for Aomi Build calls. */
  githubUserId?: string;
  actor?: string;
}

export interface ProjectDeploymentAttempt {
  id: number;
  previousRunId?: number | null;
  number?: number;
  attempt: number;
  commit: string;
  branch: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
  updatedAt?: string;
  diagnostics?: string[];
  jobs?: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    startedAt: string | null;
    completedAt: string | null;
    url: string;
    steps: Array<{ name: string; status: string; conclusion: string | null }>;
  }>;
}
