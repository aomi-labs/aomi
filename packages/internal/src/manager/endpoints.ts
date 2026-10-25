/**
 * Every manager operation, one row each: a function from the caller's input
 * to the request it makes and how the response body reads. The scope helpers
 * (`user`, `project`, `builder`, `platform`) own the path prefix, the
 * `github_user_id` query and the id checks, so a row states only what is its
 * own. Input checks throw `INVALID_REQUEST` before anything is sent.
 */
import { DeployError } from "@aomi-labs/deploy";
import type {
  ActivateResult,
  ActivateUserProjectReleasesInput,
  BuilderAppKeyInput,
  BuilderBotsInput,
  BuilderModelKeysInput,
  CheckUserBotWebhookInput,
  ClaimGitHubProjectInput,
  CreateUserBotInput,
  DeactivateApplicationInput,
  DeleteBuilderModelKeyInput,
  DeleteUserBotInput,
  DeployInput,
  DeployResult,
  ExchangeGitHubCodeInput,
  GetBuilderApplicationInput,
  GetUserObservabilityInput,
  GetUserProjectDeploymentInput,
  GetUserProjectInput,
  GetUserProjectUsageInput,
  GetUserStatementsInput,
  IngestSecretsInput,
  ListAppSecretsInput,
  ListDeploymentRecordsInput,
  ListUserDeploymentsInput,
  ListUserLogsInput,
  ListUserProjectDeploymentsInput,
  ListUserProjectLogsInput,
  ListUserProjectsInput,
  ListUserProjectTransactionsInput,
  ListUserTransactionsInput,
  OperateLogCursor,
  OperateTransactionCursor,
  OwnedOperateProjectInput,
  PreflightInput,
  ProjectDeploymentAttempt,
  PromoteInput,
  PromoteResult,
  PromoteUserProjectDeploymentInput,
  RemoveAppSecretInput,
  RerunDeploymentInput,
  RerunDeploymentResult,
  RevealUserBotCommandSecretInput,
  SaveBuilderModelKeyInput,
  ScaffoldInput,
  SetModelKeyGrantsInput,
  StatusInput,
  UpdateUserBotInput,
  UpdateUserBotResult,
} from "@aomi-labs/deploy";
import {
  ActivateResult as ActivateResultSchema,
  BotRegistration as BotRegistrationSchema,
  BotWebhookStatus,
  BuilderAppKey as BuilderAppKeySchema,
  BuilderApplication,
  BuilderModelKey,
  ClaimGitHubProjectResult as ClaimGitHubProjectResultSchema,
  DeployResult as DeployResultSchema,
  DeploymentRecord,
  DeploymentStatus,
  GitHubAppInstallationsResult,
  GitHubIdentity,
  OperateAppDetailResult,
  OperateLogsResult,
  OperateObservabilityResult,
  OperateObservabilitySnapshot,
  OperatePaymentProjectResult,
  OperateStatementResult,
  OperateTransactionsResult,
  OperateUsageResult,
  Project,
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
  RerunDeploymentResult as RerunDeploymentResultSchema,
  ServerTagsResult,
  UserDeploymentsPage,
  UserLogsResult,
  UserProject,
  UserProjectAppsResult,
  UserProjectLatestDeployment,
  UserProjectRequiredSecretsResult,
  UserTransactionsResult,
  list,
  maybe,
} from "@aomi-labs/deploy/schemas";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A response body: the parsed JSON object, or `{}` for anything else. */
export type Raw = Record<string, any>;

type Scalar = string | number | null | undefined;

/** One manager request and how its body reads. */
export type ManagerRequest<O> = {
  /** The operation's name, which labels a `BackendError`. */
  op: string;
  method?: Method;
  path: string;
  /** Query parameters; empty values are left out. */
  query?: Record<string, Scalar>;
  /** The JSON body; a POST, PUT or PATCH without one sends `{}`. */
  body?: unknown;
  headers?: Record<string, string>;
  read: (raw: Raw) => O;
};

type Row<O> = Omit<ManagerRequest<O>, "path">;

const GITHUB_APP = "/api/integrations/github-app";

/** The account-wide `/user/*` routes, narrowed to one project when the input names it. */
function user<O>(
  input: { githubUserId: string; projectId?: number; visibilityGrant?: string },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  return {
    ...row,
    path: `${GITHUB_APP}/user/${suffix}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      project_id: input.projectId === undefined ? undefined : positive(input.projectId, "projectId"),
      ...row.query,
    },
    headers: { ...grant(input.visibilityGrant), ...row.headers },
  };
}

/** One owned project's `/user/projects/:id/*` routes. */
function project<O>(
  input: { githubUserId: string; projectId: number },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  const id = positive(input.projectId, "projectId");
  return {
    ...row,
    path: `${GITHUB_APP}/user/projects/${id}${suffix ? `/${suffix}` : ""}`,
    query: { github_user_id: required(input.githubUserId, "githubUserId"), ...row.query },
  };
}

/** The builder's `/builder/applications/:id/*` routes. */
function application<O>(
  input: { githubUserId: string; applicationId: number },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  const id = positive(input.applicationId, "applicationId");
  return {
    ...row,
    path: `${GITHUB_APP}/builder/applications/${id}${suffix ? `/${suffix}` : ""}`,
    query: { github_user_id: required(input.githubUserId, "githubUserId"), ...row.query },
  };
}

/** The builder's model keys, which the manager reads per platform. */
function keys<O>(input: BuilderModelKeysInput, suffix: string, row: Row<O>): ManagerRequest<O> {
  return {
    ...row,
    path: `${GITHUB_APP}/user/model-keys${suffix ? `/${suffix}` : ""}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      platform: required(input.platform, "platform"),
    },
  };
}

/** `/api/platforms/:platform/*` */
function platform<O>(input: { platform: string }, suffix: string, row: Row<O>): ManagerRequest<O> {
  return { ...row, path: `/api/platforms/${segment(required(input.platform, "platform"))}/${suffix}` };
}

/** The application-scoped secrets vault, a service route. */
function vault<O>(row: Row<O>): ManagerRequest<O> {
  return { ...row, path: "/api/_internal/secrets" };
}

function positive(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DeployError("INVALID_REQUEST", `${field} must be a positive integer`);
  }
  return id;
}

function segment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function grant(visibilityGrant: string | undefined): Record<string, string> {
  const value = visibilityGrant?.trim();
  return value ? { "X-Aomi-Visibility-Grant": value } : {};
}

/** A positive page size, or nothing. */
function limit(value: number | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function dates(input: { fromDate?: string; toDate?: string }) {
  return { from_date: trimmed(input.fromDate), to_date: trimmed(input.toDate) };
}

export function required(value: string | undefined | null, field: string): string {
  const clean = value?.trim();
  if (!clean) throw new DeployError("INVALID_REQUEST", `${field} is required`);
  return clean;
}

/** Reads `field` of the body with `schema`; without a field, the whole body. */
function read<O>(schema: { parse(value: unknown): O }, field?: string): (raw: Raw) => O {
  return (raw) => schema.parse(field ? raw[field] : raw);
}

function present<T>(value: T | null | undefined): value is T {
  return Boolean(value);
}

/** The manager pages with the cursor it sent, re-encoded as JSON. */
function cursor(value: OperateTransactionCursor | OperateLogCursor | string | null | undefined): string | null {
  if (!value || typeof value === "string") return value || null;
  return JSON.stringify(
    "eventType" in value
      ? { occurred_at: value.occurredAt, event_type: value.eventType, id: value.id }
      : { created_at: value.createdAt, id: value.id },
  );
}

function botPath(input: { botId: string }, suffix = ""): string {
  return `bots/${segment(required(input.botId, "botId"))}${suffix}`;
}

function botBody(input: CreateUserBotInput | UpdateUserBotInput) {
  return {
    application_ids: input.applicationIds,
    handover_application_id: input.handoverApplicationId,
    label: input.label,
    thread_mode: input.threadMode,
    mini_app_url: input.miniAppUrl,
    command_endpoint: input.commandEndpoint,
    commands: input.commands,
  };
}

function promoted(deploymentId: string, ok: boolean, activation: ActivateResult["activation"]): PromoteResult {
  return {
    ok,
    promote: {
      deploymentId,
      releaseTags: activation.apps.map((app) => app.releaseTag).filter(present),
      status: ok ? "promoted" : "blocked",
      activation,
    },
  };
}

/** A git commit SHA, lowercased. */
function sourceRef(ref: string | undefined): string {
  const clean = required(ref, "sourceRef");
  if (!/^[0-9a-f]{7,40}$/i.test(clean)) {
    throw new DeployError("INVALID_REQUEST", "sourceRef must be a git commit SHA (7-40 hex chars)");
  }
  return clean.toLowerCase();
}

function deployRow(input: PreflightInput | DeployInput, op: "preflight" | "deploy"): ManagerRequest<DeployResult> {
  return {
    op,
    method: "POST",
    path: `/api/projects/${positive(input.projectId, "projectId")}/deploy`,
    // Preflight may omit the ref (the manager resolves the default head); a deploy always pins
    // the exact preflight commit.
    body:
      op === "preflight"
        ? { ...(input.sourceRef ? { source_ref: sourceRef(input.sourceRef) } : {}), preflight: true }
        : { source_ref: sourceRef(input.sourceRef) },
    read: (raw) => {
      const result = DeployResultSchema.parse(raw);
      if (!result.ok) {
        throw new DeployError("BACKEND", `${op} rejected by backend (deployment ${result.deployment.id})`);
      }
      return result;
    },
  };
}

export const ENDPOINTS = {
  // ── Deploy and release ───────────────────────────────────────────────────
  preflight: (input: PreflightInput) => deployRow(input, "preflight"),
  deploy: (input: DeployInput) => deployRow(input, "deploy"),

  status: (input: StatusInput) =>
    platform(input, `deployments/${segment(required(input.deploymentId, "deploymentId"))}/status`, {
      op: "status",
      query: { github_user_id: trimmed(input.githubUserId) },
      read: read(DeploymentStatus),
    }),

  /** Promote a recorded deployment through the one activation door. */
  promote: (input: PromoteInput) => {
    const deploymentId = required(input.deploymentId, "deploymentId");
    return platform(input, "apps/activate", {
      op: "promote",
      method: "POST",
      body: {
        target: { kind: "deployment", value: deploymentId },
        ...(input.apps?.length ? { apps: input.apps } : {}),
        ...(input.targetTags?.length ? { target_tags: input.targetTags } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
      },
      read: (raw) => {
        const { ok, activation } = ActivateResultSchema.parse(raw);
        return promoted(deploymentId, ok, activation);
      },
    });
  },

  /** Clear one app's live pointer and unload its binary; the deployment record stays. */
  deactivateApplication: (input: DeactivateApplicationInput) =>
    platform(input, `applications/${positive(input.applicationId, "applicationId")}/deactivate`, {
      op: "deactivate",
      method: "POST",
      read: () => undefined,
    }),

  /** Re-run the GitHub Actions run behind a deployment's recorded commit. */
  rerunDeployment: (input: RerunDeploymentInput) => {
    const deploymentId = required(input.deploymentId, "deploymentId");
    return platform(input, `deployments/${segment(deploymentId)}/rerun`, {
      op: "rerun",
      method: "POST",
      query: { github_user_id: trimmed(input.githubUserId) },
      read: (raw): RerunDeploymentResult => ({ ...RerunDeploymentResultSchema.parse(raw), deploymentId }),
    });
  },

  serverTags: () => ({
    op: "server tags",
    path: "/api/platforms/server-tags",
    read: read(ServerTagsResult),
  }),

  /** Create a repository from a template and persist its project. */
  scaffold: (input: ScaffoldInput) => ({
    op: "scaffold",
    method: "POST" as const,
    path: `${GITHUB_APP}/platforms/${segment(required(input.platform, "platform"))}/projects/create-from-template`,
    body: {
      installation_id: positive(input.installationId, "installationId"),
      template_repo: required(input.templateRepo, "templateRepo"),
      repo_name: required(input.repoName, "repoName"),
      github_user_id: required(input.githubUserId, "githubUserId"),
      private: Boolean(input.private),
    },
    read: read(Project, "project"),
  }),

  listDeploymentRecords: (input: ListDeploymentRecordsInput) => {
    const app = required(input.app, "app");
    return platform(input, `apps/${segment(app)}/records`, {
      op: "list_deployment_records",
      query: { project_id: input.projectId },
      read: (raw) => ({
        app: typeof raw.app === "string" ? raw.app : app,
        currentReleaseTag: typeof raw.current_release_tag === "string" ? raw.current_release_tag : null,
        records: list(DeploymentRecord).parse(raw.records),
      }),
    });
  },

  // ── Secrets vault (handle names only, never values) ──────────────────────
  ingestSecrets: (input: IngestSecretsInput) =>
    vault({
      op: "ingest_secrets",
      method: "POST",
      body: {
        application_id: positive(input.applicationId, "applicationId"),
        app: required(input.app, "app"),
        secrets: input.secrets,
      },
      read: (raw) => ({ handles: (raw.handles ?? {}) as Record<string, string> }),
    }),

  listAppSecrets: (input: ListAppSecretsInput) =>
    vault({
      op: "list_secrets",
      query: { application_id: positive(input.applicationId, "applicationId") },
      read: (raw) => ({ byApp: (raw.by_app ?? {}) as Record<string, string[]> }),
    }),

  /** Remove one app-scoped secret; answers whether it existed. */
  removeAppSecret: (input: RemoveAppSecretInput) =>
    vault({
      op: "remove_secret",
      method: "DELETE",
      body: { application_id: positive(input.applicationId, "applicationId"), name: required(input.name, "name") },
      read: (raw) => Boolean(raw.removed),
    }),

  // ── Sign-in ──────────────────────────────────────────────────────────────
  /** Exchange a GitHub OAuth `code` for the user's identity; the client secret stays in the manager. */
  exchangeGitHubCode: (input: ExchangeGitHubCodeInput) => ({
    op: "exchange_github_code",
    path: `${GITHUB_APP}/oauth/exchange`,
    query: { code: required(input.code, "code"), app: input.app, redirect_uri: trimmed(input.redirectUri) },
    read: read(GitHubIdentity),
  }),

  claimGitHubProject: (input: ClaimGitHubProjectInput) => ({
    op: "claim_github_project",
    method: "POST" as const,
    path: `${GITHUB_APP}/oauth/claim`,
    body: {
      code: required(input.code, "code"),
      project_id: positive(input.projectId, "projectId"),
      redirect_uri: input.redirectUri,
    },
    read: read(ClaimGitHubProjectResultSchema),
  }),

  // ── Projects ─────────────────────────────────────────────────────────────
  listUserProjects: (input: ListUserProjectsInput) =>
    user(input, "projects", {
      op: "list_user_projects",
      query: { platform: trimmed(input.platform) },
      read: read(list(UserProject), "projects"),
    }),

  getUserProject: (input: GetUserProjectInput) =>
    project(input, "", {
      op: "get_user_project",
      headers: grant(input.visibilityGrant),
      read: read(UserProject),
    }),

  /** Live GitHub access for the builder's connected source repositories. */
  listUserGitHubAppInstallations: (input: { githubUserId: string }) =>
    user(input, "installations", { op: "list_user_github_app_installations", read: read(GitHubAppInstallationsResult) }),

  /** One project's apps with their live flags. */
  listUserProjectApps: (input: OwnedOperateProjectInput) =>
    project(input, "apps", {
      op: "list_user_project_apps",
      read: read(UserProjectAppsResult),
    }),

  getUserProjectRequiredSecrets: (input: OwnedOperateProjectInput) =>
    project(input, "required-secrets", {
      op: "get_user_project_required_secrets",
      read: read(UserProjectRequiredSecretsResult),
    }),

  upgradeUserProjectSdk: (input: OwnedOperateProjectInput) =>
    project(input, "sdk-upgrade", { op: "upgrade_user_project_sdk", method: "POST", read: read(ProjectSdkUpgradeResult) }),

  /** The upgrade PR's merge state in one GitHub-backed read; safe to poll. */
  sdkUpgradeStatus: (input: OwnedOperateProjectInput) =>
    project(input, "sdk-upgrade-status", { op: "get_project_sdk_upgrade_status", read: read(ProjectSdkUpgradeStatusResult) }),

  // ── Deployments ──────────────────────────────────────────────────────────
  listUserDeployments: (input: ListUserDeploymentsInput) =>
    user(input, "deployments", {
      op: "list_user_deployments",
      query: {
        platform: trimmed(input.platform),
        limit: limit(input.limit),
        cursor_created_at: input.cursor?.createdAt,
        cursor_id: input.cursor?.id,
      },
      read: read(UserDeploymentsPage),
    }),

  getUserProjectLatestDeployment: (input: OwnedOperateProjectInput) =>
    project(input, "latest-deployment", {
      op: "get_user_project_latest_deployment",
      read: read(maybe(UserProjectLatestDeployment), "latest_deployment"),
    }),

  listUserProjectDeployments: (input: ListUserProjectDeploymentsInput) =>
    project(input, "deployments", {
      op: "list_user_project_deployments",
      query: { limit: limit(input.limit) },
      read: (raw) => list(maybe(UserProjectLatestDeployment)).parse(raw.deployments).filter(present),
    }),

  getUserProjectDeployment: (input: GetUserProjectDeploymentInput) =>
    project(input, `deployments/${segment(required(input.deploymentId, "deploymentId"))}`, {
      op: "get_user_project_deployment",
      read: read(maybe(UserProjectLatestDeployment), "deployment"),
    }),

  promoteUserProjectDeployment: (input: PromoteUserProjectDeploymentInput) => {
    const deploymentId = required(input.deploymentId, "deploymentId");
    return project(input, `deployments/${segment(deploymentId)}/promote`, {
      op: "promote",
      method: "POST",
      body: {
        mode: input.mode,
        ...(input.apps?.length ? { apps: input.apps } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
      },
      read: (raw) => promoted(deploymentId, raw.ok === true, ActivateResultSchema.parse(raw).activation),
    });
  },

  activateUserProjectReleases: (input: ActivateUserProjectReleasesInput) =>
    project(input, "releases/activate", {
      op: "activate",
      method: "POST",
      body: { release_tags: input.releaseTags, apps: input.apps, ...(input.actor ? { actor: input.actor } : {}) },
      read: read(ActivateResultSchema),
    }),

  projectDeploymentAttempts: (input: OwnedOperateProjectInput & { runId?: number; page?: number }) =>
    project(input, input.runId === undefined ? "attempts" : `attempts/${input.runId}`, {
      op: "deployment_status",
      query: { page: input.page || undefined },
      read: (raw) =>
        raw as { attempts?: ProjectDeploymentAttempt[]; attempt?: ProjectDeploymentAttempt; nextPage?: number | null },
    }),

  startProjectDeploymentAttempt: (input: OwnedOperateProjectInput & { branch?: string }) =>
    project(input, "attempts", {
      op: "deploy",
      method: "POST",
      body: { branch: input.branch },
      read: (raw) => raw as { attempt: ProjectDeploymentAttempt; existing: boolean },
    }),

  cancelProjectDeploymentAttempt: (input: OwnedOperateProjectInput & { runId: number }) =>
    project(input, `attempts/${input.runId}/cancel`, {
      op: "deploy",
      method: "POST",
      read: (raw) => raw as { ok: boolean; status?: string },
    }),

  // ── Builder applications ─────────────────────────────────────────────────
  getBuilderApplication: (input: GetBuilderApplicationInput) =>
    application(input, "", {
      op: "get_builder_application",
      read: read(BuilderApplication),
    }),

  getBuilderApplicationDetail: (input: GetBuilderApplicationInput) =>
    application(input, "detail", { op: "get_builder_application_detail", read: read(OperateAppDetailResult) }),

  /** The private application's current Build key, or null before one is issued. */
  getBuilderAppKey: (input: BuilderAppKeyInput) =>
    application(input, "app-key", { op: "get_builder_app_key", read: read(BuilderAppKeySchema, "app_key") }),

  /** Issue a new Build key; any earlier key stops working at once. */
  regenerateBuilderAppKey: (input: BuilderAppKeyInput) =>
    application(input, "app-key", {
      op: "regenerate_builder_app_key",
      method: "POST",
      read: (raw) => {
        const key = BuilderAppKeySchema.parse(raw.app_key);
        if (!key) throw new DeployError("BACKEND", "app key response is missing `app_key`");
        return key;
      },
    }),

  // ── Bots ─────────────────────────────────────────────────────────────────
  listUserBots: (input: BuilderBotsInput) => user(input, "bots", { op: "list_user_bots", read: read(list(BotRegistrationSchema), "bot_registrations") }),

  createUserBot: (input: CreateUserBotInput) =>
    user(input, "bots", {
      op: "create_user_bot",
      method: "POST",
      body: {
        platform: required(input.botPlatform, "botPlatform"),
        credential: required(input.credential, "credential"),
        ...botBody(input),
      },
      read: read(BotRegistrationSchema, "bot_registration"),
    }),

  updateUserBot: (input: UpdateUserBotInput) =>
    user(input, botPath(input), {
      op: "update_user_bot",
      method: "PATCH",
      body: botBody(input),
      read: (raw): UpdateUserBotResult => ({
        ...BotRegistrationSchema.parse(raw.bot_registration),
        ...(typeof raw.webhook_warning === "string" && raw.webhook_warning ? { webhookWarning: raw.webhook_warning } : {}),
      }),
    }),

  /** Compare Telegram's registered webhook with the manager's; a mismatch is re-asserted. */
  checkUserBotWebhook: (input: CheckUserBotWebhookInput) =>
    user(input, botPath(input, "/webhook"), {
      op: "check_user_bot_webhook",
      method: "POST",
      read: read(BotWebhookStatus, "webhook"),
    }),

  /** The bot's derived command-signing secret, which the caller shows once. */
  revealUserBotCommandSecret: (input: RevealUserBotCommandSecretInput) =>
    user(input, botPath(input, "/command-secret"), {
      op: "reveal_user_bot_command_secret",
      read: (raw) => ({ commandSecret: String(raw.command_secret ?? "") }),
    }),

  deleteUserBot: (input: DeleteUserBotInput) =>
    user(input, botPath(input), { op: "delete_user_bot", method: "DELETE", read: () => undefined }),

  // ── Model keys (names, prefixes and grants; key material is write-only) ──
  listBuilderModelKeys: (input: BuilderModelKeysInput) =>
    keys(input, "", { op: "list_builder_model_keys", read: read(list(BuilderModelKey), "keys") }),

  /** Create (no `keyId`) or rotate (`keyId` set) a builder model key. */
  saveBuilderModelKey: (input: SaveBuilderModelKeyInput) =>
    keys(input, input.keyId === undefined ? "" : segment(input.keyId), {
      op: "save_builder_model_key",
      method: input.keyId === undefined ? "POST" : "PUT",
      body: { provider: required(input.provider, "provider"), key: required(input.key, "key"), label: input.label },
      read: read(BuilderModelKey, "key"),
    }),

  deleteBuilderModelKey: (input: DeleteBuilderModelKeyInput) =>
    keys(input, segment(positive(input.keyId, "keyId")), {
      op: "delete_builder_model_key",
      method: "DELETE",
      read: () => undefined,
    }),

  /** Replace a key's grant set. */
  setModelKeyGrants: (input: SetModelKeyGrantsInput) =>
    keys(input, `${positive(input.keyId, "keyId")}/grants`, {
      op: "set_model_key_grants",
      method: "PUT",
      body: { application_ids: input.applicationIds, model_ids: input.modelIds },
      read: read(BuilderModelKey, "key"),
    }),

  // ── Operate: one project ─────────────────────────────────────────────────
  listUserProjectTransactions: (input: ListUserProjectTransactionsInput) =>
    project(input, "transactions", {
      op: "list_user_project_transactions",
      query: { limit: limit(input.limit), status: trimmed(input.status), cursor: cursor(input.cursor) },
      read: read(OperateTransactionsResult),
    }),

  getUserProjectUsage: (input: GetUserProjectUsageInput) =>
    project(input, "usage", { op: "get_user_project_usage", query: dates(input), read: read(OperateUsageResult) }),

  getUserProjectStatement: (input: GetUserProjectUsageInput) =>
    project(input, "statement", { op: "get_user_project_statement", query: dates(input), read: read(OperateStatementResult) }),

  listUserProjectLogs: (input: ListUserProjectLogsInput) =>
    project(input, "logs", {
      op: "list_user_project_logs",
      query: { limit: limit(input.limit), type: trimmed(input.type), cursor: cursor(input.cursor) },
      read: read(OperateLogsResult),
    }),

  getUserProjectObservability: (input: OwnedOperateProjectInput) =>
    project(input, "observability", { op: "get_user_project_observability", read: read(OperateObservabilityResult) }),

  // ── Operate: the account, each project under its own bound platform ──────
  getUserObservability: (input: GetUserObservabilityInput) =>
    user(input, "observability", {
      op: "get_user_observability",
      read: read(list(OperateObservabilitySnapshot), "results"),
    }),

  getUserPayments: (input: GetUserObservabilityInput) =>
    user(input, "payments", {
      op: "get_user_payments",
      read: read(list(OperatePaymentProjectResult), "results"),
    }),

  /** One newest-first page merged across every owned project, with one cursor. */
  listUserTransactions: (input: ListUserTransactionsInput) =>
    user(input, "transactions", {
      op: "list_user_transactions",
      query: { limit: limit(input.limit), status: trimmed(input.status), cursor: cursor(input.cursor) },
      read: read(UserTransactionsResult),
    }),

  getUserStatements: (input: GetUserStatementsInput) =>
    user(input, "statement", {
      op: "get_user_statement",
      query: dates(input),
      read: read(list(OperateStatementResult), "results"),
    }),

  getUserUsage: (input: GetUserStatementsInput) =>
    user(input, "usage", {
      op: "get_user_usage",
      query: dates(input),
      read: read(list(OperateUsageResult), "results"),
    }),

  /** One newest-first page of the merged log stream; shared partner settlements carry a null `projectId`. */
  listUserLogs: (input: ListUserLogsInput) =>
    user(input, "logs", {
      op: "list_user_logs",
      query: { limit: limit(input.limit), type: trimmed(input.type), cursor: cursor(input.cursor) },
      read: read(UserLogsResult),
    }),
} satisfies Record<string, (input: never) => ManagerRequest<unknown>>;

export type Endpoints = typeof ENDPOINTS;
