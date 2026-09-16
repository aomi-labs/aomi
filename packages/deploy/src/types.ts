// =============================================================================
// Public input/output types for the repo-scoped platform deploy contract.
// =============================================================================

export interface AomiConfig {
  /** Backend base URL, e.g. "https://api-staging.aomi.dev". */
  backendUrl: string;
  /**
   * Bearer token for platform/app activation (deploy / activate / status, and
   * the bootstrap reads). Optional so a bootstrap-only client can be built with
   * just `adminBearer`. Server-side only.
   */
  activationToken?: string;
  /**
   * Privileged admin/service AomiBearer for bootstrap writes — minting the very
   * first platform token, which no activation token can do yet. Mint it with
   * `@aomi-labs/service` (the signing twin). Server-side only.
   */
  adminBearer?: string;
}

export interface AuditEvent {
  action:
    | "request"
    | "preflight"
    | "deploy"
    | "activate"
    | "promote"
    | "rerun"
    | "status"
    | "mint_token"
    | "list_tokens"
    | "revoke_token"
    | "create_project"
    | "scaffold"
    | "list_user_project_apps"
    | "exchange_github_code"
    | "list_user_projects"
    | "get_user_project"
    | "get_builder_application"
    | "list_user_deployments"
    | "list_user_project_deployments"
    | "list_user_project_bots"
    | "create_user_project_bot"
    | "delete_user_project_bot"
    | "list_user_bots"
    | "create_user_bot"
    | "update_user_bot"
    | "delete_user_bot"
    | "list_builder_model_keys"
    | "save_builder_model_key"
    | "delete_builder_model_key"
    | "set_model_key_grants"
    | "list_user_project_transactions"
    | "get_user_project_usage"
    | "get_user_project_statement"
    | "list_user_project_logs"
    | "get_user_project_observability"
    | "get_user_observability"
    | "get_user_payments"
    | "list_user_transactions"
    | "get_user_statement"
    | "get_user_usage"
    | "list_user_logs"
    | "get_builder_application_detail"
    | "upgrade_user_project_sdk"
    | "get_project_sdk_upgrade_status"
    | "list_deployment_records"
    | "get_user_project_latest_deployment"
    | "get_user_project_deployment"
    | "get_user_project_required_secrets"
    | "deactivate"
    | "ingest_secrets";
  platform?: string;
  projectId?: number;
  applicationId?: number;
  apps?: string[];
  targetTags?: string[];
  /** Token scope for `mint_token`. */
  scope?: TokenScope;
  /** Source repo / scaffolded repo name for source + scaffold ops. */
  repo?: string;
  /** Token id for `revoke_token`. */
  tokenId?: number;
  actor?: string;
  ts: number;
}

export interface BackendClientOptions {
  aomi: AomiConfig;
  /** Called on every privileged op. The proxy should persist this. */
  onAudit?: (event: AuditEvent) => void | Promise<void>;
}

export interface ListSecretsInput extends BearerOverride {
  githubUserId?: string;
  clientId?: string;
}

export interface ListSecretsResult {
  byApp: Record<string, string[]>;
}

export interface IngestSecretsInput extends BearerOverride {
  applicationId: number;
  app: string;
  secrets: Record<string, string>;
}

export interface IngestSecretsResult {
  handles: Record<string, string>;
}

export interface ListAppSecretsInput extends BearerOverride {
  applicationId: number;
}

export interface RemoveAppSecretInput extends BearerOverride {
  applicationId: number;
  name: string;
}

export interface ServerTagsResult {
  serverTags: string[];
  sdkVersion: string;
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

export type DeployStatus =
  | "preflight"
  | "pr_created"
  | "pr_updated"
  | "unchanged";
export type CiStatus = "no_ci" | "pending" | "running" | "passed" | "failed";

export interface DeployResult {
  ok: boolean;
  deployment: DeployPayload;
}

export interface DeployPayload {
  id: string;
  status: DeployStatus | string;
  sdkVersion?: string | null;
  source: Source;
  platform: Platform;
}

export interface Source {
  installationId: number;
  repositoryId: number;
  repositoryLink: string;
  ref: SourceRef;
  commitHash: string;
}

export interface Platform {
  platform: string;
  repository: string;
  deployBranch: string;
  /** Generated branch in the platform repository (never a source-repo branch). */
  platformBranch: string;
  commitHash: string | null;
  prNumber: number | null;
  prUrl: string | null;
  ciStatus: CiStatus | null;
  ciUrl: string | null;
  apps: AppRecord[];
}

export interface AppRecord {
  name: string;
  path: string;
  aomiTomlPath: string;
  releaseTag: string;
  sdkVersion?: string | null;
  target?: string | null;
  files: AppFileRecord[];
}

export interface AppFileRecord {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ReleaseTags {
  kind: "release_tags";
  value: string[];
}

export interface ActivateInput {
  platform: string;
  target: ReleaseTags;
  /** Apps to activate. Optional; the backend can derive names from release tags. */
  apps?: string[];
  targetTags?: string[];
  actor?: string;
}

export interface ActivateResult {
  ok: boolean;
  activation: {
    status: "activating" | "partial_failed" | string;
    platform: string;
    target: {
      kind: string;
      value: unknown;
      platformRepo?: string | null;
      platformBranch?: string | null;
      platformCommitHash?: string | null;
      ciStatus?: CiStatus | null;
      ciUrl?: string | null;
      promoted: ActivationPromotion[];
    };
    apps: ActivatedApp[];
  };
}

export interface ActivationPromotion {
  name: string;
  releaseTag: string;
  platformBranch: string;
  platformCommitHash: string | null;
  liveCommitHash?: string | null;
  activationStatus?: "promoted" | "unchanged" | string | null;
  ciStatus: CiStatus | string;
  ciUrl: string | null;
  releaseAssets: string[];
  releaseAssetDigests?: Record<string, string>;
}

export interface ActivatedApp {
  applicationId?: number | null;
  name: string;
  path?: string | null;
  releaseTag?: string | null;
  isActive: boolean;
  artifactReady?: boolean | null;
  loaded: boolean;
  error?: string | null;
  platformBranch?: string | null;
  liveCommitHash?: string | null;
  activationStatus?: "promoted" | "unchanged" | string | null;
  activationPr?: unknown | null;
  activationPrCloseError?: string | null;
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

// NEW — replaces StatusResult = unknown
export interface DeploymentStatus {
  state: "no_ci" | "building" | "releasing" | "ready" | "failed" | "pending";
  deployment?: DeployPayload;
  releaseTags: string[];
  apps?: DeploymentAppStatus[];
  ci?: { status?: string; url?: string; commitHash?: string };
  message?: string;
}

export interface DeploymentAppStatus {
  name: string;
  releaseTag: string;
  releaseReady: boolean;
  releaseAssets?: string[];
  releaseAssetDigests?: Record<string, string>;
  message?: string | null;
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

// =============================================================================
// Bootstrap surface — the runbook steps before deploy.
//
// Twin of the Rust `aomi-build` bootstrap commands; every call maps 1:1 onto a
// `/api/platforms/*` route (mint a token → resolve/scaffold a source → list
// apps). The `bearer` override lets a single client carry both an activation
// token (deploy/activate) and a privileged admin bearer (token minting).
// =============================================================================

/** Per-call bearer override — wins over the client's configured tokens. */
interface BearerOverride {
  /**
   * Bearer to authorize this call. For `mintToken` this is the privileged
   * admin/service AomiBearer; otherwise an activation token. Defaults to the
   * client's configured token (admin-preferred for privileged writes).
   */
  bearer?: string;
  actor?: string;
}

// ── Tokens (POST/GET/DELETE /api/platforms/:p/tokens) ────────────────────────

export type TokenScope = "platform" | "app";

export interface MintTokenInput extends BearerOverride {
  platform: string;
  scope: TokenScope;
  /** Required when `scope === "app"`. The target `applications.id`. */
  appId?: number;
}

/** Plaintext is returned ONCE at mint time; the backend stores only its hash. */
export interface MintedToken {
  id: number;
  token: string;
  scope: TokenScope | string;
}

export interface TokenRecord {
  id: number;
  scope: TokenScope | string | null;
  appId: number | null;
  tokenHashPrefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  appsUsage: string[] | null;
  platformUsage: string | null;
}

export interface ListTokensInput extends BearerOverride {
  platform: string;
}

export interface RevokeTokenInput extends BearerOverride {
  platform: string;
  id: number;
}

// ── Projects (POST create / POST create-from-template) ─────────────────────

export interface Project {
  id: number;
  installationId: number;
  repositoryId: number;
  repositoryLink: string;
  platformId: number;
  ownerBuilderId: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProjectInput extends BearerOverride {
  platform: string;
  /** `owner/name` of a repo already installed on the Aomi GitHub App. */
  repo: string;
  /** Signed-in GitHub user that owns the project. */
  githubUserId: string;
}

export interface ScaffoldInput extends BearerOverride {
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

// ── Platform apps ────────────────────────────────────────────────────────────

export interface AppPricingBeneficiary {
  name: string;
  type: string;
  chain: string;
  value: string;
}

export interface AppPricingResource {
  pricing: { flat: number };
  beneficiary?: string | null;
}

export interface AppPricingSnapshot {
  loadedAt: number;
  config: {
    version: number;
    beneficiaries: AppPricingBeneficiary[];
    resources: Record<string, AppPricingResource>;
    outcome: Array<Record<string, unknown>>;
  };
}

export interface PlatformApp {
  id: number;
  name: string;
  label: string | null;
  platform: string | null;
  isActive: boolean;
  isPublic: boolean;
  projectId: number | null;
  appReleaseTag: string | null;
  targetTags: string[];
  loaded: boolean;
  artifactReady?: boolean | null;
  /** Exact runtime-validated pricing sidecar for the loaded release. */
  pricing?: AppPricingSnapshot | null;
}

// ── GitHub identity + per-user sources (the sign-in dashboard) ────────────────

export interface ExchangeGitHubCodeInput extends BearerOverride {
  /** GitHub OAuth authorization code from the sign-in redirect. */
  code: string;
  /** Which configured GitHub App (1 = build, 2 = oneshot). */
  app?: number;
  /** Redirect URI used when the authorization code was issued. */
  redirectUri?: string;
}

export interface ClaimGitHubProjectInput extends BearerOverride {
  code: string;
  projectId: number;
  redirectUri?: string;
}

export interface ClaimGitHubProjectResult {
  githubUserId: string;
  project: UserProject;
}

export interface GitHubIdentity {
  githubUserId: string;
  githubLogin: string;
  /**
   * Most-recent installation of the exchanged App visible to this user, if any.
   * Lets the portal skip the install step when the App is already installed.
   */
  installationId: string | null;
  /** Opaque Manager-signed, 10-minute installation visibility snapshot. */
  visibilityGrant?: string | null;
}

export interface ListUserProjectsInput extends BearerOverride {
  githubUserId: string;
  platform?: string;
  visibilityGrant?: string;
}

export interface GetUserProjectInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
  visibilityGrant?: string;
}

export interface GetBuilderApplicationInput extends BearerOverride {
  githubUserId: string;
  applicationId: number;
}

export interface BuilderApplication {
  project: Project;
  platform: string;
  application: PlatformApp;
}

export interface GetUserProjectLatestDeploymentInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
}

/** DB-backed declarations for the project's currently live app releases. */
export interface GetUserProjectRequiredSecretsInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
}

export interface UserProjectRequiredSecretsResult {
  byApp: Record<string, { applicationId: number; slots: SecretSlot[] }>;
}

export interface ListUserProjectDeploymentsInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
  limit?: number;
}

/** Exact candidate projection; unlike the paged history this is safe for
 * authorization and for a deployment's first promotion. */
export interface GetUserProjectDeploymentInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
  deploymentId: string;
}

export interface PromoteUserProjectDeploymentInput extends GetUserProjectDeploymentInput {
  mode: "targeted" | "apply_composition";
  apps?: string[];
  actor?: string;
}

export interface ActivateUserProjectReleasesInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
  releaseTags: string[];
  apps: string[];
  actor?: string;
}

export interface UserDeploymentsCursor {
  createdAt: number;
  id: number;
}

export interface ListUserDeploymentsInput extends BearerOverride {
  githubUserId: string;
  platform?: string;
  limit?: number;
  cursor?: UserDeploymentsCursor | null;
}

/** One append-only promotion record from the backend deployment log. */
export interface DeploymentRecord {
  deploymentId: string;
  releaseTag: string;
  actor: string | null;
  createdAt: number;
  sdkVersion: string | null;
  current: boolean;
}

export interface ListDeploymentRecordsInput extends BearerOverride {
  platform: string;
  app: string;
  /** Disambiguates same-named apps across projects on one platform. */
  projectId?: number;
}

export interface DeactivateApplicationInput extends BearerOverride {
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

export interface UserProjectDeploymentApp {
  name: string;
  releaseTag: string | null;
  sdkVersion?: string | null;
  target?: string | null;
  applicationId?: number | null;
  projectId?: number | null;
  appReleaseTag?: string | null;
  isActive?: boolean;
  artifactReady?: boolean | null;
  loaded?: boolean;
}

export interface UserProjectLatestDeployment {
  deploymentId: string | null;
  state: string | null;
  /** Generated branch in the platform repository for this deployment. */
  platformBranch: string | null;
  platformRepo: string | null;
  commitHash: string | null;
  ciStatus: string | null;
  ciUrl: string | null;
  ciRunId?: string | number | null;
  releaseTags: string[];
  sdkVersion?: string | null;
  artifactTarget?: string | null;
  buildTarget?: string | null;
  /** Epoch seconds of the deploy request (`created_at`). */
  createdAt: number;
  apps: UserProjectDeploymentApp[];
}

export interface UserDeployment extends UserProjectLatestDeployment {
  projectId: number;
  repositoryLink: string;
}

export interface UserDeploymentsPage {
  deployments: UserDeployment[];
  nextCursor: UserDeploymentsCursor | null;
}

export interface ProjectApplicationManifest {
  path: string;
  name: string;
  sdkVersion: string | null;
  target: string;
}

export type ProjectConfiguration =
  | {
      status: "valid";
      revision: string;
      configHash: string;
      applications: ProjectApplicationManifest[];
    }
  | {
      status: "invalid";
      checkedRevision: string;
      reason:
        | "config-missing"
        | "config-invalid"
        | "manifest-missing"
        | "manifest-invalid"
        | "application-name-conflict"
        | "platform-mismatch";
      lastValidRevision: string | null;
    };

/** A platform-bound project plus its applications. */
export interface UserProject extends Project {
  platformName: string;
  apps: PlatformApp[];
  configuration?: ProjectConfiguration;
  latestDeployment?: UserProjectLatestDeployment | null;
  /** SDK version of the project's live app, from DB promotion records. */
  sdkVersion?: string | null;
  /** All distinct SDK versions running across this project's live apps. */
  sdkVersions?: string[];
}

/** One project's apps with live flags, from `GET /user/projects/:id/apps`
 *  — the project-scoped replacement for the retired platform-door app
 *  reads. */
export interface UserProjectAppsResult {
  project: Project;
  platform: string;
  apps: PlatformApp[];
}

/** Project-scoped read: the backend derives the bound platform from the
 *  project row — callers never supply one. */
export interface OwnedOperateProjectInput extends BearerOverride {
  githubUserId: string;
  projectId: number;
}

/** Account-wide observability batch: the manager reports every owned project
 *  under its own bound platform. */
export interface GetUserObservabilityInput extends BearerOverride {
  githubUserId: string;
  /** Optional project narrowing for an observability deep link. */
  projectId?: number;
}

export interface GetUserPaymentsInput extends GetUserObservabilityInput {}

/** Account-wide operate batch reads (`/user/transactions|statement|usage|logs`).
 *  The manager reads every owned project under its own bound platform —
 *  partner-bound projects included. */
export interface UserOperateBatchInput extends BearerOverride {
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

export interface GetBuilderApplicationDetailInput extends GetBuilderApplicationInput {}

export type ProjectSdkUpgradeResult =
  | {
      status: "current";
      requiredSdkVersion: string;
      sourceRef: string;
    }
  | {
      status: "pull_request";
      requiredSdkVersion: string;
      sourceRef: string;
      branch: string;
      files: string[];
      pullRequest: {
        number: number;
        url: string;
        created: boolean;
      };
    }
  | {
      status: "manual";
      requiredSdkVersion: string;
      sourceRef: string;
      reason: string;
      command: string;
    };

/**
 * Cheap read-only merge poll for the upgrade PR opened by an earlier
 * `upgradeUserProjectSdk` call. `merged` is terminal (redeploy from the merged
 * default branch); `open` means keep polling; `closed`/`none` mean the PR is
 * gone, so re-run the upgrade to recreate it.
 */
export type ProjectSdkUpgradeStatusResult = {
  status: "merged" | "open" | "closed" | "none";
  requiredSdkVersion: string;
  branch: string;
  pullRequest: {
    number: number;
    url: string;
    state: string;
    merged: boolean;
  } | null;
};

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

export interface OperateTransactionCursor {
  createdAt: number;
  id: string;
}

export interface OperateLogCursor {
  occurredAt: number;
  eventType: string;
  id: string;
}

export interface BotRegistration {
  id: string;
  platform: string;
  status: string;
  label: string | null;
  defaultApp: string;
  defaultAppId?: number;
  apps: BotRegistrationApp[];
  platformBotId: string;
  platformUsername: string | null;
  webhookUrl: string | null;
  threadMode: string;
  createdAt: number;
}

export interface BotRegistrationApp {
  applicationId: number;
  projectId: number | null;
  projectLabel: string | null;
  name: string;
  label: string;
  platform: string | null;
  isPrimary: boolean;
}

export interface BuilderBotsInput extends BearerOverride {
  githubUserId: string;
}

export interface CreateUserBotInput extends BuilderBotsInput {
  applicationIds: number[];
  primaryApplicationId: number;
  botPlatform: string;
  credential: string;
  label?: string;
  threadMode?: string;
}

export interface UpdateUserBotInput extends BuilderBotsInput {
  botId: string;
  applicationIds: number[];
  primaryApplicationId: number;
  /** Omitted = unchanged; blank clears the label (manager semantics). */
  label?: string;
  /** Omitted = unchanged; "single" | "multi". */
  threadMode?: string;
}

export interface DeleteUserBotInput extends BuilderBotsInput {
  botId: string;
}

export interface CreateUserProjectBotInput extends OwnedOperateProjectInput {
  applicationId: number;
  /** The bot's platform (e.g. "telegram") — distinct from `platform`, which
   *  is the deploy platform (e.g. "community"). Maps to the request body's
   *  `platform` field. */
  botPlatform: string;
  /** Passed through to the backend; never stored, logged, or returned. */
  credential: string;
  label?: string;
  threadMode?: string;
}

/** All-time funded-turn rollup the manager reports for a key. `costCredits`
 *  is the insert-time model cost the platform would have charged (1 credit =
 *  $0.01) — funded turns record it even though the user was charged 0. */
export interface BuilderModelKeyUsage {
  inputTokens: number;
  outputTokens: number;
  costCredits: number;
  turns: number;
}

export interface BuilderModelKeyAppUsage extends BuilderModelKeyUsage {
  applicationId: number;
}

/** A builder-owned LLM model key (funder-ladder app rung): provider +
 *  recognizable prefix + the applications it is granted to. Never carries
 *  key material. */
export interface BuilderModelKey {
  id: number;
  provider: string;
  label: string | null;
  keyPrefix: string;
  createdAt: number;
  updatedAt: number;
  applicationIds: number[];
  usage: BuilderModelKeyUsage;
  usageByApplication: BuilderModelKeyAppUsage[];
}

export interface BuilderModelKeysInput extends BearerOverride {
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
}

export interface DeleteUserProjectBotInput extends OwnedOperateProjectInput {
  botId: string;
}

export interface OperateTransaction {
  id: string;
  externalTxId: string;
  application: string;
  applicationId: number | null;
  status: string;
  /** EVM tx hash or SVM signature */
  txHash: string | null;
  chainId: number;
  fromAddress: string;
  toAddress: string;
  value: string;
  hasCalldata: boolean;
  calldataPreview: string | null;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  // Receipt contract — null until the confirmation watcher lands.
  family: "evm" | "svm" | null;
  chainName: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  valueUsd: string | null;
  block: string | null;
  slot: string | null;
  confirmations: number | null;
  gasUsed: string | null;
  gasLimit: string | null;
  effGasPrice: string | null;
  computeUnits: string | null;
  computeLimit: string | null;
  priorityFee: string | null;
  txFee: string | null;
  platformFee: string | null;
  nonce: number | null;
  method: string | null;
  transfers: string[] | null;
  revertReason: string | null;
  explorerUrl: string | null;
}

export interface OperateTransactionsResult {
  project: Project;
  platform: string;
  transactions: OperateTransaction[];
  nextCursor: OperateTransactionCursor | null;
}

/** One owned project and the platform it resolves under, from a batch read. */
export interface UserProjectRef {
  project: Project;
  platform: string;
}

/** A batch row is the single-project row plus which project it belongs to. */
export type UserTransactionRow = OperateTransaction & {
  projectId: number | null;
  platform: string | null;
};

/** Account-wide transactions page: one merged newest-first stream. */
export interface UserTransactionsResult {
  projects: UserProjectRef[];
  transactions: UserTransactionRow[];
  nextCursor: OperateTransactionCursor | null;
}

export interface OperateUsageDailyRow {
  periodUtcDay: string;
  application: string;
  applicationId: number;
  inputTokens: number;
  outputTokens: number;
  creditsUsed: number;
}

export interface OperateUsageBreakdownRow {
  provider: string;
  model: string;
  paymentMethod: string;
  inputTokens: number;
  outputTokens: number;
  creditsUsed: number;
  events: number;
}

export interface OperateUsageResult {
  project: Project;
  platform: string;
  range: { fromDate: string; toDate: string; maxDays: number };
  daily: OperateUsageDailyRow[];
  breakdown: OperateUsageBreakdownRow[];
}

// Statement contract — mirrors the manager's `/user/projects/:id/statement`
// endpoint (bank-statement model: Aomi's statement to the builder, one
// document, entries of both signs). Charges (`model`, `hosting` subjects)
// carry negative net; earnings (`tool_invocation`, `outcome`) positive.
// Amounts are raw USD floats off the wire; the UI formats at render time.
export interface OperateStatementSummary {
  grossRevenue: number;
  platformFees: number;
  serviceCharges: number;
  net: number;
}

export interface OperateStatementRevenueRow {
  subject: string;
  application: string;
  applicationId: number | null;
  events: number;
  gross: number;
  platformFee: number;
  net: number;
}

export interface OperateStatementChargeRow {
  item: string;
  application: string;
  applicationId: number | null;
  events: number;
  amount: number;
}

export interface OperateStatementEntry {
  day: string;
  application: string;
  subject: string;
  events: number;
  gross: number;
  platformFee: number;
  net: number;
}

export interface OperatePartnerPaymentSummary {
  accruedCredits: number;
  accruedUsd: number;
  settledCredits: number;
  settledUsd: number;
  outstandingCredits: number;
  outstandingUsd: number;
  pricedCalls: number;
  settlements: number;
}

export interface OperatePartnerPaymentResource {
  application: string;
  applicationId: number | null;
  tool: string;
  flatCredits: number;
  flatUsd: number;
  beneficiary: string | null;
  recipient: string | null;
  chain: string | null;
  beneficiaryType: string | null;
  observedCalls: number;
}

export interface OperatePartnerPaymentBucket {
  id: string;
  recipient: string;
  outstandingCredits: number;
  outstandingUsd: number;
}

export interface OperatePartnerPaymentEvent {
  id: string;
  kind: "fee_accrued" | "settlement_confirmed" | string;
  occurredAt: number;
  application: string | null;
  applicationId: number | null;
  tools: string[];
  credits: number;
  usd: number;
  asset: string | null;
  assetAmount: number | null;
  recipient: string;
  paymentMethod: string;
  receiptId: string | null;
  chain: string | null;
  explorerUrl: string | null;
}

export interface OperatePartnerPayments {
  available: boolean;
  scope: "recipient_bucket" | string;
  summary: OperatePartnerPaymentSummary;
  resources: OperatePartnerPaymentResource[];
  buckets: OperatePartnerPaymentBucket[];
  events: OperatePartnerPaymentEvent[];
}

export interface OperateStatementResult {
  project: Project;
  platform: string;
  range: { fromDate: string; toDate: string };
  /** False when statement_entries isn't migrated yet — fall back to the meter. */
  available: boolean;
  summary: OperateStatementSummary;
  revenue: OperateStatementRevenueRow[];
  charges: OperateStatementChargeRow[];
  entries: OperateStatementEntry[];
  payments: OperatePartnerPayments;
}

export interface OperateModelKeyAttribution {
  id: number;
  label: string | null;
  /** Short cleartext prefix already exposed on the Providers page. */
  prefix: string | null;
}

export interface OperateLogEntry {
  occurredAt: number;
  eventType: string;
  id: string;
  application: string;
  applicationId: number | null;
  summary: string;
  details: Record<string, unknown>;
  /** Builder-owned key that funded this usage event; null for other events. */
  modelKey?: OperateModelKeyAttribution | null;
  // Invocation-trace contract — null/absent for plain control-plane events.
  // Privacy: args/results are operational payloads; user intents never ship.
  kind: "invocation" | "event" | null;
  status: "ok" | "error" | "info" | null;
  tool: string | null;
  durationMs: number | null;
  retries: number | null;
  threadId: string | null;
  args: string | null;
  result: string | null;
}

export interface OperateLogsResult {
  project: Project;
  platform: string;
  logs: OperateLogEntry[];
  nextCursor: OperateLogCursor | null;
}

/** A batch log row names its project; shared partner settlements carry null. */
export type UserLogRow = OperateLogEntry & {
  projectId: number | null;
  platform: string | null;
};

/** Account-wide logs page: one merged newest-first stream. */
export interface UserLogsResult {
  projects: UserProjectRef[];
  logs: UserLogRow[];
  nextCursor: OperateLogCursor | null;
  invocationsAvailable: boolean;
}

export interface OperateAppHealth {
  applicationId: number;
  application: string;
  active: boolean;
  loaded: boolean;
  releaseTag: string | null;
  sdkVersion: string | null;
  status: "healthy" | "not_loaded" | "inactive" | string;
  metrics?: OperateAppMetrics | null;
  pricing?: AppPricingSnapshot | null;
}

export interface OperateAppMetrics {
  provider: "grafana_prometheus" | string;
  windowSeconds: number;
  available: boolean;
  requestsPerMinute: number | null;
  /** Chat-request error rate; tool/tx failures are separate domains below. */
  errorRate: number | null;
  p95LatencyMs: number | null;
  inflightRequests: number | null;
  /** 24h trend contract, oldest bucket first. */
  trendWindowSeconds: number | null;
  chats24h: number | null;
  toolCalls24h: number | null;
  transactions24h: number | null;
  /** Hourly counts over the trend window, oldest bucket first. */
  chatsHourly: number[] | null;
  toolCallsHourly: number[] | null;
  transactionsHourly: number[] | null;
  toolErrorRate: number | null;
  txErrorRate: number | null;
  coldStartMs: number | null;
  dylibBytes: number | null;
}

export interface OperateDashboardLink {
  label: string;
  url: string;
  scope: string;
}

export interface OperatePlatformMetric {
  label: string;
  value: number | null;
  unit: string;
  scope: "platform" | string;
  description?: string;
}

export interface OperateMonitoringStatus {
  provider: "grafana_prometheus" | string;
  status: "ok" | "partial" | "unavailable" | "unconfigured" | string;
  windowSeconds: number;
}

export interface OperateObservabilityResult {
  project: Project;
  platform: string;
  scope: "owned_applications" | string;
  monitoring?: OperateMonitoringStatus | null;
  apps: OperateAppHealth[];
  dashboardLinks: OperateDashboardLink[];
  platformMetrics: OperatePlatformMetric[];
  payments: OperatePartnerPayments;
}

/** Account-wide snapshots omit the optional payment-ledger read. */
export type OperateObservabilitySnapshot = Omit<
  OperateObservabilityResult,
  "payments"
>;

export interface OperatePaymentProjectResult {
  project: Project;
  payments: OperatePartnerPayments;
}

export interface OperateAppDetailTool {
  tool: string;
  calls: number | null;
  errors: number | null;
  errorRate: number | null;
  p95Ms: number | null;
  lastError: {
    message: string | null;
    occurredAt: number;
  } | null;
}

export interface OperateAppDetailResult {
  project: Project;
  platform: string;
  windowSeconds: number;
  app: {
    applicationId: number;
    name: string;
    releaseTag: string | null;
    sdkVersion: string | null;
    active: boolean;
    loaded: boolean;
    status: string;
  };
  funnel: {
    chats24h: number | null;
    toolCalls24h: number | null;
    txProposed24h: number | null;
    txSubmitted24h: number | null;
    txConfirmed24h: number | null;
    txReverted24h: number | null;
  };
  activeUsers24h: number | null;
  credits: {
    credits24h: number | null;
    creditsPerTurn24h: number | null;
    creditsDaily: Array<{ day: string; credits: number }>;
  };
  tools: OperateAppDetailTool[];
  lifecycle: {
    coldStartMs: number | null;
    dylibBytes: number | null;
    loads24h: number | null;
    evictions24h: number | null;
  };
  hourly: {
    chats: number[] | null;
    toolCalls: number[] | null;
    /** Per-hour chat request P95, in milliseconds. `null` means no samples. */
    p95LatencyMs: Array<number | null> | null;
    transactions: number[] | null;
  };
}

// =============================================================================
// Deployment-management surface. These types are shared by the standalone
// dashboard/TUI work while the current launch routes remain compatible.
// =============================================================================

export interface RedactedDeploymentSecret {
  name: string;
  app?: string | null;
  scope: "user_app" | "user" | "project" | string;
  configured: boolean;
  updatedAt?: string | null;
}

export interface RedactedDeploymentEnvVar {
  name: string;
  app?: string | null;
  scope: "app" | "project" | string;
  configured: boolean;
  updatedAt?: string | null;
}

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
    status: "promoted" | "blocked" | string;
    sdkStatus?: SdkVersionStatus | null;
    activation?: ActivateResult["activation"];
  };
}

/** A secret an app declares via the SDK's `Secret::new(name, description, required)`. */
export interface SecretSlot {
  name: string;
  description: string;
  required: boolean;
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

export interface RerunDeploymentResult {
  ok: boolean;
  deploymentId: string;
  commitHash: string | null;
  runId: number | null;
  ciUrl: string | null;
}
