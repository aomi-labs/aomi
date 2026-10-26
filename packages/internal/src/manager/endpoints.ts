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
  BotRegistration,
  BuilderAppKey,
  BuilderAppKeyInput,
  BuilderBotsInput,
  BuilderModelKeysInput,
  CheckUserBotWebhookInput,
  ClaimGitHubProjectInput,
  ClaimGitHubProjectResult,
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
  OwnedOperateProjectInput,
  PreflightInput,
  ProjectDeploymentAttempt,
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
  PromoteInput,
  PromoteResult,
  PromoteUserProjectDeploymentInput,
  RemoveAppSecretInput,
  RerunDeploymentInput,
  RevealUserBotCommandSecretInput,
  SaveBuilderModelKeyInput,
  ScaffoldInput,
  SetModelKeyGrantsInput,
  StatusInput,
  UpdateUserBotInput,
  UpdateUserBotResult,
  UserDeployment,
  UserProjectLatestDeployment,
} from "@aomi-labs/deploy";
import {
  camelActivateResult,
  camelBotRegistration,
  camelBotWebhookStatus,
  camelBuilderModelKey,
  camelDeployResult,
  camelGitHubAppInstallations,
  camelLogCursor,
  camelLogRow,
  camelOperateAppDetail,
  camelOperateLogs,
  camelOperateObservability,
  camelOperateStatement,
  camelOperateTransactions,
  camelOperateUsage,
  camelPartnerPayments,
  camelPlatformApp,
  camelProject,
  camelStatusResult,
  camelTransactionCursor,
  camelTransactionRow,
  camelUserDeployment,
  camelUserDeploymentsCursor,
  camelUserProject,
  camelUserProjectLatestDeployment,
  camelUserProjectRefs,
  deployRequest,
  encodeLogCursor,
  encodeTransactionCursor,
  optNumber,
  optString,
  required,
  responseRecord,
  timestampSeconds,
} from "@aomi-labs/deploy/wire";

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

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value : [];
}

function present<T>(value: T | null | undefined): value is T {
  return Boolean(value);
}

const botRegistrations = (raw: Raw): BotRegistration[] => list(raw.bot_registrations).map(camelBotRegistration);

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

/** A project-scoped row tagged with the project and platform it came from. */
function tagged<T>(row: Raw, camel: (row: Raw) => T) {
  return { ...camel(row), projectId: optNumber(row.project_id ?? row.projectId), platform: optString(row.platform) };
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

function deployRow(input: PreflightInput | DeployInput, op: "preflight" | "deploy"): ManagerRequest<DeployResult> {
  return {
    op,
    method: "POST",
    path: `/api/projects/${positive(input.projectId, "projectId")}/deploy`,
    body: deployRequest(input, op === "preflight"),
    read: (raw) => {
      const result = camelDeployResult(raw);
      if (!result.ok) {
        throw new DeployError("BACKEND", `${op} rejected by backend (deployment ${result.deployment.id})`);
      }
      return result;
    },
  };
}

function unknownSdkStatus(): never {
  throw new DeployError("BACKEND", "backend returned an unknown source SDK upgrade status");
}

function sdkUpgrade(raw: Raw): ProjectSdkUpgradeResult {
  const common = {
    requiredSdkVersion: String(raw.required_sdk_version ?? ""),
    sourceRef: String(raw.source_ref ?? ""),
  };
  if (raw.status === "current") return { status: "current", ...common };
  if (raw.status === "manual") {
    return {
      status: "manual",
      ...common,
      reason: String(raw.reason ?? "SDK upgrade requires a local change."),
      command: String(raw.command ?? ""),
    };
  }
  if (raw.status !== "pull_request") return unknownSdkStatus();
  const pullRequest = responseRecord(raw.pull_request, "pull_request");
  return {
    status: "pull_request",
    ...common,
    branch: String(raw.branch ?? ""),
    files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    pullRequest: {
      number: Number(pullRequest.number),
      url: String(pullRequest.url ?? ""),
      created: Boolean(pullRequest.created),
    },
  };
}

function sdkUpgradeStatus(raw: Raw): ProjectSdkUpgradeStatusResult {
  const { status } = raw;
  if (status !== "merged" && status !== "open" && status !== "closed" && status !== "none") {
    return unknownSdkStatus();
  }
  const pr = raw.pull_request && typeof raw.pull_request === "object" ? (raw.pull_request as Raw) : null;
  return {
    status,
    requiredSdkVersion: String(raw.required_sdk_version ?? ""),
    branch: String(raw.branch ?? ""),
    pullRequest: pr
      ? { number: Number(pr.number), url: String(pr.url ?? ""), state: String(pr.state ?? ""), merged: Boolean(pr.merged) }
      : null,
  };
}

function requiredSecretSlots(slots: unknown) {
  return list(slots).flatMap((slot) =>
    typeof slot.name === "string" && typeof slot.description === "string" && typeof slot.required === "boolean"
      ? [
          {
            name: slot.name,
            description: slot.description,
            required: slot.required,
            ...(slot.user_own === true ? { user_own: true } : {}),
          },
        ]
      : [],
  );
}

function builderAppKey(raw: unknown): BuilderAppKey | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Raw;
  const key = optString(row.key);
  if (!key) return null;
  return {
    key,
    keyPrefix: optString(row.key_prefix) ?? key.slice(0, 8),
    applicationId: Number(row.application_id ?? 0),
    createdAt: Number(row.created_at ?? 0),
    lastUsedAt: typeof row.last_used_at === "number" ? row.last_used_at : null,
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
      read: camelStatusResult,
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
        const { ok, activation } = camelActivateResult(raw);
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
      read: (raw) => ({
        ok: raw.ok === true,
        deploymentId,
        commitHash: typeof raw.commit_hash === "string" ? raw.commit_hash : null,
        runId: typeof raw.run_id === "number" ? raw.run_id : null,
        ciUrl: typeof raw.ci_url === "string" ? raw.ci_url : null,
      }),
    });
  },

  serverTags: () => ({
    op: "server tags",
    path: "/api/platforms/server-tags",
    read: (raw: Raw) => ({
      serverTags: (raw.server_tags ?? raw.serverTags ?? []) as string[],
      sdkVersion: String(raw.sdk_version ?? raw.sdkVersion ?? ""),
      ffiVersion: (raw.ffi_version ?? raw.ffiVersion ?? null) as number | null,
      ffiInterfaces: (raw.ffi_interfaces ?? raw.ffiInterfaces ?? []) as string[],
    }),
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
    read: (raw: Raw) => camelProject(raw.project),
  }),

  listDeploymentRecords: (input: ListDeploymentRecordsInput) => {
    const app = required(input.app, "app");
    return platform(input, `apps/${segment(app)}/records`, {
      op: "list_deployment_records",
      query: { project_id: input.projectId },
      read: (raw) => ({
        app: (raw.app as string | undefined) ?? app,
        currentReleaseTag: (raw.current_release_tag as string | null) ?? null,
        records: list(raw.records).map((row) => ({
          deploymentId: String(row.deployment_id ?? ""),
          releaseTag: String(row.release_tag ?? ""),
          actor: (row.actor as string | null) ?? null,
          createdAt: timestampSeconds(row.created_at),
          sdkVersion: (row.sdk_version as string | null) ?? null,
          current: Boolean(row.current),
        })),
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
    read: (raw: Raw) => ({
      githubUserId: String(raw.github_user_id ?? ""),
      githubLogin: String(raw.github_login ?? ""),
      installationId: raw.installation_id == null ? null : String(raw.installation_id),
      visibilityGrant: typeof raw.visibility_grant === "string" ? raw.visibility_grant : null,
    }),
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
    read: (raw: Raw): ClaimGitHubProjectResult => ({
      githubUserId: String(raw.github_user_id ?? ""),
      project: camelUserProject(raw.project ?? {}),
    }),
  }),

  // ── Projects ─────────────────────────────────────────────────────────────
  listUserProjects: (input: ListUserProjectsInput) =>
    user(input, "projects", {
      op: "list_user_projects",
      query: { platform: trimmed(input.platform) },
      read: (raw) => list(raw.projects).map(camelUserProject),
    }),

  getUserProject: (input: GetUserProjectInput) =>
    project(input, "", {
      op: "get_user_project",
      headers: grant(input.visibilityGrant),
      read: camelUserProject,
    }),

  /** Live GitHub access for the builder's connected source repositories. */
  listUserGitHubAppInstallations: (input: { githubUserId: string }) =>
    user(input, "installations", { op: "list_user_github_app_installations", read: camelGitHubAppInstallations }),

  /** One project's apps with their live flags. */
  listUserProjectApps: (input: OwnedOperateProjectInput) =>
    project(input, "apps", {
      op: "list_user_project_apps",
      read: (raw) => ({
        project: camelProject(raw.project),
        platform: optString(raw.platform) ?? "",
        apps: list(raw.apps).map(camelPlatformApp),
      }),
    }),

  getUserProjectRequiredSecrets: (input: OwnedOperateProjectInput) =>
    project(input, "required-secrets", {
      op: "get_user_project_required_secrets",
      read: (raw) => ({
        byApp: Object.fromEntries(
          Object.entries((raw.by_app ?? {}) as Record<string, Raw>).map(([app, value]) => [
            app,
            { applicationId: Number(value.application_id), slots: requiredSecretSlots(value.slots) },
          ]),
        ),
      }),
    }),

  upgradeUserProjectSdk: (input: OwnedOperateProjectInput) =>
    project(input, "sdk-upgrade", { op: "upgrade_user_project_sdk", method: "POST", read: sdkUpgrade }),

  /** The upgrade PR's merge state in one GitHub-backed read; safe to poll. */
  sdkUpgradeStatus: (input: OwnedOperateProjectInput) =>
    project(input, "sdk-upgrade-status", { op: "get_project_sdk_upgrade_status", read: sdkUpgradeStatus }),

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
      read: (raw) => ({
        deployments: list(raw.deployments)
          .map(camelUserDeployment)
          .filter((deployment): deployment is UserDeployment => present(deployment)),
        nextCursor: camelUserDeploymentsCursor(raw.next_cursor),
      }),
    }),

  getUserProjectLatestDeployment: (input: OwnedOperateProjectInput) =>
    project(input, "latest-deployment", {
      op: "get_user_project_latest_deployment",
      read: (raw) => camelUserProjectLatestDeployment(raw.latest_deployment) ?? null,
    }),

  listUserProjectDeployments: (input: ListUserProjectDeploymentsInput) =>
    project(input, "deployments", {
      op: "list_user_project_deployments",
      query: { limit: limit(input.limit) },
      read: (raw) =>
        list(raw.deployments)
          .map(camelUserProjectLatestDeployment)
          .filter((deployment): deployment is UserProjectLatestDeployment => present(deployment)),
    }),

  getUserProjectDeployment: (input: GetUserProjectDeploymentInput) =>
    project(input, `deployments/${segment(required(input.deploymentId, "deploymentId"))}`, {
      op: "get_user_project_deployment",
      read: (raw) => camelUserProjectLatestDeployment(raw.deployment) ?? null,
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
      read: (raw) => promoted(deploymentId, raw.ok === true, camelActivateResult(raw).activation),
    });
  },

  activateUserProjectReleases: (input: ActivateUserProjectReleasesInput) =>
    project(input, "releases/activate", {
      op: "activate",
      method: "POST",
      body: { release_tags: input.releaseTags, apps: input.apps, ...(input.actor ? { actor: input.actor } : {}) },
      read: camelActivateResult,
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
      read: (raw) => ({
        project: camelProject(raw.project),
        platform: optString(raw.platform) ?? "",
        application: camelPlatformApp(raw.application),
      }),
    }),

  getBuilderApplicationDetail: (input: GetBuilderApplicationInput) =>
    application(input, "detail", { op: "get_builder_application_detail", read: camelOperateAppDetail }),

  /** The private application's current Build key, or null before one is issued. */
  getBuilderAppKey: (input: BuilderAppKeyInput) =>
    application(input, "app-key", { op: "get_builder_app_key", read: (raw) => builderAppKey(raw.app_key) }),

  /** Issue a new Build key; any earlier key stops working at once. */
  regenerateBuilderAppKey: (input: BuilderAppKeyInput) =>
    application(input, "app-key", {
      op: "regenerate_builder_app_key",
      method: "POST",
      read: (raw) => {
        const key = builderAppKey(raw.app_key);
        if (!key) throw new DeployError("BACKEND", "app key response is missing `app_key`");
        return key;
      },
    }),

  // ── Bots ─────────────────────────────────────────────────────────────────
  listUserBots: (input: BuilderBotsInput) => user(input, "bots", { op: "list_user_bots", read: botRegistrations }),

  createUserBot: (input: CreateUserBotInput) =>
    user(input, "bots", {
      op: "create_user_bot",
      method: "POST",
      body: {
        platform: required(input.botPlatform, "botPlatform"),
        credential: required(input.credential, "credential"),
        ...botBody(input),
      },
      read: (raw) => camelBotRegistration(raw.bot_registration),
    }),

  updateUserBot: (input: UpdateUserBotInput) =>
    user(input, botPath(input), {
      op: "update_user_bot",
      method: "PATCH",
      body: botBody(input),
      read: (raw): UpdateUserBotResult => ({
        ...camelBotRegistration(raw.bot_registration),
        ...(typeof raw.webhook_warning === "string" && raw.webhook_warning ? { webhookWarning: raw.webhook_warning } : {}),
      }),
    }),

  /** Compare Telegram's registered webhook with the manager's; a mismatch is re-asserted. */
  checkUserBotWebhook: (input: CheckUserBotWebhookInput) =>
    user(input, botPath(input, "/webhook"), {
      op: "check_user_bot_webhook",
      method: "POST",
      read: (raw) => camelBotWebhookStatus(raw.webhook),
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
    keys(input, "", { op: "list_builder_model_keys", read: (raw) => list(raw.keys).map(camelBuilderModelKey) }),

  /** Create (no `keyId`) or rotate (`keyId` set) a builder model key. */
  saveBuilderModelKey: (input: SaveBuilderModelKeyInput) =>
    keys(input, input.keyId === undefined ? "" : segment(input.keyId), {
      op: "save_builder_model_key",
      method: input.keyId === undefined ? "POST" : "PUT",
      body: { provider: required(input.provider, "provider"), key: required(input.key, "key"), label: input.label },
      read: (raw) => camelBuilderModelKey(raw.key),
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
      read: (raw) => camelBuilderModelKey(raw.key),
    }),

  // ── Operate: one project ─────────────────────────────────────────────────
  listUserProjectTransactions: (input: ListUserProjectTransactionsInput) =>
    project(input, "transactions", {
      op: "list_user_project_transactions",
      query: { limit: limit(input.limit), status: trimmed(input.status), cursor: encodeTransactionCursor(input.cursor) },
      read: camelOperateTransactions,
    }),

  getUserProjectUsage: (input: GetUserProjectUsageInput) =>
    project(input, "usage", { op: "get_user_project_usage", query: dates(input), read: camelOperateUsage }),

  getUserProjectStatement: (input: GetUserProjectUsageInput) =>
    project(input, "statement", { op: "get_user_project_statement", query: dates(input), read: camelOperateStatement }),

  listUserProjectLogs: (input: ListUserProjectLogsInput) =>
    project(input, "logs", {
      op: "list_user_project_logs",
      query: { limit: limit(input.limit), type: trimmed(input.type), cursor: encodeLogCursor(input.cursor) },
      read: camelOperateLogs,
    }),

  getUserProjectObservability: (input: OwnedOperateProjectInput) =>
    project(input, "observability", { op: "get_user_project_observability", read: camelOperateObservability }),

  // ── Operate: the account, each project under its own bound platform ──────
  getUserObservability: (input: GetUserObservabilityInput) =>
    user(input, "observability", {
      op: "get_user_observability",
      read: (raw) =>
        list(raw.results).map((entry) => {
          const { payments: _payments, ...snapshot } = camelOperateObservability(entry);
          return snapshot;
        }),
    }),

  getUserPayments: (input: GetUserObservabilityInput) =>
    user(input, "payments", {
      op: "get_user_payments",
      read: (raw) =>
        list(raw.results).map((entry) => ({
          project: camelProject(entry.project),
          payments: camelPartnerPayments(entry.payments),
        })),
    }),

  /** One newest-first page merged across every owned project, with one cursor. */
  listUserTransactions: (input: ListUserTransactionsInput) =>
    user(input, "transactions", {
      op: "list_user_transactions",
      query: { limit: limit(input.limit), status: trimmed(input.status), cursor: encodeTransactionCursor(input.cursor) },
      read: (raw) => ({
        projects: camelUserProjectRefs(raw.projects),
        transactions: list(raw.transactions).map((row) => tagged(row, camelTransactionRow)),
        nextCursor: camelTransactionCursor(raw.next_cursor ?? raw.nextCursor),
      }),
    }),

  getUserStatements: (input: GetUserStatementsInput) =>
    user(input, "statement", {
      op: "get_user_statement",
      query: dates(input),
      read: (raw) => list(raw.results).map((entry) => camelOperateStatement(entry)),
    }),

  getUserUsage: (input: GetUserStatementsInput) =>
    user(input, "usage", {
      op: "get_user_usage",
      query: dates(input),
      read: (raw) => list(raw.results).map((entry) => camelOperateUsage(entry)),
    }),

  /** One newest-first page of the merged log stream; shared partner settlements carry a null `projectId`. */
  listUserLogs: (input: ListUserLogsInput) =>
    user(input, "logs", {
      op: "list_user_logs",
      query: { limit: limit(input.limit), type: trimmed(input.type), cursor: encodeLogCursor(input.cursor) },
      read: (raw) => ({
        projects: camelUserProjectRefs(raw.projects),
        logs: list(raw.logs).map((row) => tagged(row, camelLogRow)),
        nextCursor: camelLogCursor(raw.next_cursor ?? raw.nextCursor),
        invocationsAvailable: raw.invocations_available !== false,
      }),
    }),
} satisfies Record<string, (input: never) => ManagerRequest<unknown>>;

export type Endpoints = typeof ENDPOINTS;
