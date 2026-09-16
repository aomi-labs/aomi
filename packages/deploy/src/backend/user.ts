import { DeployError } from "../errors";
import type {
  BotRegistration,
  BuilderBotsInput,
  BuilderModelKey,
  BuilderModelKeysInput,
  CreateUserBotInput,
  CreateUserProjectBotInput,
  DeleteBuilderModelKeyInput,
  DeleteUserBotInput,
  DeleteUserProjectBotInput,
  ExchangeGitHubCodeInput,
  ClaimGitHubProjectInput,
  ClaimGitHubProjectResult,
  GetBuilderApplicationDetailInput,
  GetBuilderApplicationInput,
  GetUserProjectInput,
  GetUserObservabilityInput,
  ActivateUserProjectReleasesInput,
  GetUserPaymentsInput,
  GetUserProjectLatestDeploymentInput,
  GetUserProjectDeploymentInput,
  GetUserProjectRequiredSecretsInput,
  GetUserProjectUsageInput,
  GetUserStatementsInput,
  GitHubIdentity,
  ListUserDeploymentsInput,
  ListUserLogsInput,
  ListUserProjectDeploymentsInput,
  PromoteUserProjectDeploymentInput,
  ListUserProjectLogsInput,
  ListUserProjectTransactionsInput,
  ListUserProjectsInput,
  ListUserTransactionsInput,
  ActivateResult,
  PromoteResult,
  OperateAppDetailResult,
  OperateLogsResult,
  OperateObservabilityResult,
  OperateObservabilitySnapshot,
  OperatePaymentProjectResult,
  OperateStatementResult,
  OperateTransactionsResult,
  OperateUsageResult,
  OwnedOperateProjectInput,
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
  SaveBuilderModelKeyInput,
  SetModelKeyGrantsInput,
  UpdateUserBotInput,
  UserDeployment,
  UserDeploymentsPage,
  BuilderApplication,
  UserLogsResult,
  UserProject,
  UserProjectAppsResult,
  UserProjectLatestDeployment,
  UserProjectRequiredSecretsResult,
  UserTransactionsResult,
} from "../types";
import {
  camelBotRegistration,
  camelActivateResult,
  camelBuilderModelKey,
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
  camelTransactionCursor,
  camelTransactionRow,
  camelUserDeployment,
  camelUserDeploymentsCursor,
  camelUserProject,
  camelUserProjectLatestDeployment,
  camelUserProjectRefs,
  encodeLogCursor,
  encodeTransactionCursor,
  optNumber,
  optString,
  required,
  responseRecord,
  setDateRange,
  setLimit,
} from "../wire";
import { BackendPlatformClient } from "./platform";

function botRegistrations(raw: Record<string, unknown>): BotRegistration[] {
  return ((raw.bot_registrations ?? []) as unknown[]).map(camelBotRegistration);
}

/**
 * Server-side client to the Aomi platform deploy backend. It is a typed HTTP
 * wrapper only: source reads, platform writes, CI checks, and activation all
 * happen in the backend.
 */
export class BackendClient extends BackendPlatformClient {
  // ──────────────────── Sign-in: identity + user projects ──────────────────

  /**
   * Exchange a GitHub OAuth `code` for the user's identity (login flow). The
   * client secret stays backend-side; this is the portal's sign-in seam.
   * `GET /api/integrations/github-app/oauth/exchange`.
   */
  async exchangeGitHubCode(
    input: ExchangeGitHubCodeInput,
  ): Promise<GitHubIdentity> {
    const code = required(input.code, "code");
    const params = new URLSearchParams({ code });
    if (input.app) params.set("app", String(input.app));
    if (input.redirectUri?.trim()) {
      params.set("redirect_uri", input.redirectUri.trim());
    }
    const bearer = this.resolveBearer(input.bearer);
    const raw = await this.get<{
      github_user_id?: string;
      github_login?: string;
      installation_id?: number | string | null;
      visibility_grant?: string | null;
    }>(
      `/api/integrations/github-app/oauth/exchange?${params.toString()}`,
      "exchange_github_code",
      bearer,
    );
    return {
      githubUserId: String(raw.github_user_id ?? ""),
      githubLogin: String(raw.github_login ?? ""),
      installationId:
        raw.installation_id === null || raw.installation_id === undefined
          ? null
          : String(raw.installation_id),
      visibilityGrant:
        typeof raw.visibility_grant === "string" ? raw.visibility_grant : null,
    };
  }

  async claimGitHubProject(
    input: ClaimGitHubProjectInput,
  ): Promise<ClaimGitHubProjectResult> {
    if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
      throw new Error("projectId must be a positive integer");
    }
    const bearer = this.resolveBearer(input.bearer);
    const raw = await this.post<Record<string, unknown>>(
      "/api/integrations/github-app/oauth/claim",
      {
        code: required(input.code, "code"),
        project_id: input.projectId,
        redirect_uri: input.redirectUri,
      },
      "claim_github_project",
      bearer,
    );
    return {
      githubUserId: String(raw.github_user_id ?? ""),
      project: camelUserProject((raw.project ?? {}) as Record<string, unknown>),
    };
  }

  /**
   * Projects owned by a GitHub user. Passing `platform` narrows the result.
   */
  async listUserProjects(input: ListUserProjectsInput): Promise<UserProject[]> {
    return this.userGet(
      input,
      "projects",
      "list_user_projects",
      (raw) => ((raw.projects ?? []) as unknown[]).map(camelUserProject),
      (params) => {
        if (input.platform?.trim()) {
          params.set("platform", input.platform.trim());
        }
      },
      { platform: input.platform },
    );
  }

  async getUserProject(input: GetUserProjectInput): Promise<UserProject> {
    if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
      throw new Error("projectId must be a positive integer");
    }
    const githubUserId = required(input.githubUserId, "githubUserId");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({ github_user_id: githubUserId });
    const raw = await this.get<Record<string, unknown>>(
      this.ownedProjectBasePath(input.projectId, params),
      "get_user_project",
      bearer,
      input.visibilityGrant?.trim()
        ? { "X-Aomi-Visibility-Grant": input.visibilityGrant.trim() }
        : undefined,
    );
    await this.audit("get_user_project", input.actor, {
      projectId: input.projectId,
    });
    return camelUserProject(raw);
  }

  async getBuilderApplication(
    input: GetBuilderApplicationInput,
  ): Promise<BuilderApplication> {
    if (
      !Number.isSafeInteger(input.applicationId) ||
      input.applicationId <= 0
    ) {
      throw new Error("applicationId must be a positive integer");
    }
    const githubUserId = required(input.githubUserId, "githubUserId");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({ github_user_id: githubUserId });
    const raw = await this.get<Record<string, unknown>>(
      this.builderPath(
        `applications/${encodeURIComponent(String(input.applicationId))}`,
        params,
      ),
      "get_builder_application",
      bearer,
    );
    await this.audit("get_builder_application", input.actor, {
      applicationId: input.applicationId,
    });
    return {
      project: camelProject(raw.project),
      platform: optString(raw.platform) ?? "",
      application: camelPlatformApp(raw.application),
    };
  }

  async listUserDeployments(
    input: ListUserDeploymentsInput,
  ): Promise<UserDeploymentsPage> {
    return this.userGet(
      input,
      "deployments",
      "list_user_deployments",
      (raw) => ({
        deployments: ((raw.deployments ?? []) as unknown[])
          .map(camelUserDeployment)
          .filter((deployment): deployment is UserDeployment =>
            Boolean(deployment),
          ),
        nextCursor: camelUserDeploymentsCursor(raw.next_cursor),
      }),
      (params) => {
        if (input.platform?.trim()) {
          params.set("platform", input.platform.trim());
        }
        setLimit(params, input.limit);
        if (input.cursor) {
          params.set("cursor_created_at", String(input.cursor.createdAt));
          params.set("cursor_id", String(input.cursor.id));
        }
      },
    );
  }

  async getUserProjectLatestDeployment(
    input: GetUserProjectLatestDeploymentInput,
  ): Promise<UserProjectLatestDeployment | null> {
    return this.ownedGetLoose(
      input,
      "latest-deployment",
      "get_user_project_latest_deployment",
      (raw) => camelUserProjectLatestDeployment(raw.latest_deployment) ?? null,
    );
  }

  async getUserProjectRequiredSecrets(
    input: GetUserProjectRequiredSecretsInput,
  ): Promise<UserProjectRequiredSecretsResult> {
    return this.ownedGetLoose(
      input,
      "required-secrets",
      "get_user_project_required_secrets",
      (raw) => ({
        byApp: Object.fromEntries(
          Object.entries(
            (raw.by_app ?? {}) as Record<
              string,
              { application_id?: unknown; slots?: unknown[] }
            >,
          ).map(([app, value]) => [
            app,
            {
              applicationId: Number(value.application_id),
              slots: (value.slots ?? []).flatMap((slot) => {
                if (!slot || typeof slot !== "object") return [];
                const rawSlot = slot as Record<string, unknown>;
                const name = rawSlot.name;
                const description = rawSlot.description;
                const requiredFlag = rawSlot.required;
                return typeof name === "string" &&
                  typeof description === "string" &&
                  typeof requiredFlag === "boolean"
                  ? [{ name, description, required: requiredFlag }]
                  : [];
              }),
            },
          ]),
        ),
      }),
    );
  }

  async listUserProjectDeployments(
    input: ListUserProjectDeploymentsInput,
  ): Promise<UserProjectLatestDeployment[]> {
    return this.ownedGetLoose(
      input,
      "deployments",
      "list_user_project_deployments",
      (raw) =>
        ((raw.deployments ?? []) as unknown[])
          .map(camelUserProjectLatestDeployment)
          .filter((deployment): deployment is UserProjectLatestDeployment =>
            Boolean(deployment),
          ),
      (params) => setLimit(params, input.limit),
    );
  }

  async getUserProjectDeployment(
    input: GetUserProjectDeploymentInput,
  ): Promise<UserProjectLatestDeployment | null> {
    const deploymentId = required(input.deploymentId, "deploymentId");
    return this.ownedGetLoose(
      input,
      `deployments/${encodeURIComponent(deploymentId)}`,
      "get_user_project_deployment",
      (raw) => camelUserProjectLatestDeployment(raw.deployment) ?? null,
    );
  }

  async promoteUserProjectDeployment(
    input: PromoteUserProjectDeploymentInput,
  ): Promise<PromoteResult> {
    const deploymentId = required(input.deploymentId, "deploymentId");
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    const raw = await this.post<Record<string, unknown>>(
      this.ownedProjectPath(
        projectId,
        `deployments/${encodeURIComponent(deploymentId)}/promote`,
        params,
      ),
      {
        mode: input.mode,
        ...(input.apps?.length ? { apps: input.apps } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
      },
      "promote",
      bearer,
    );
    await this.audit("promote", input.actor, { projectId, apps: input.apps ?? [] });
    const ok = raw.ok === true;
    const activation = camelActivateResult(raw).activation;
    return {
      ok,
      promote: {
        deploymentId,
        releaseTags: activation.apps
          .map((app) => app.releaseTag)
          .filter((tag): tag is string => Boolean(tag)),
        status: ok ? "promoted" : "blocked",
        activation,
      },
    };
  }

  async activateUserProjectReleases(
    input: ActivateUserProjectReleasesInput,
  ): Promise<ActivateResult> {
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    const raw = await this.post<Record<string, unknown>>(
      this.ownedProjectPath(projectId, "releases/activate", params),
      {
        release_tags: input.releaseTags,
        apps: input.apps,
        ...(input.actor ? { actor: input.actor } : {}),
      },
      "activate",
      bearer,
    );
    await this.audit("activate", input.actor, { projectId, apps: input.apps });
    return camelActivateResult(raw);
  }

  /** One project's apps with live flags — the project-scoped replacement
   *  for the retired platform-door `GET /:platform/apps/:app`. */
  async listUserProjectApps(
    input: OwnedOperateProjectInput,
  ): Promise<UserProjectAppsResult> {
    return this.ownedGetLoose(
      input,
      "apps",
      "list_user_project_apps",
      (raw) => ({
        project: camelProject(raw.project),
        platform: optString(raw.platform) ?? "",
        apps: ((raw.apps ?? []) as unknown[]).map(camelPlatformApp),
      }),
    );
  }

  async listUserProjectBots(
    input: OwnedOperateProjectInput,
  ): Promise<BotRegistration[]> {
    return this.ownedGet(
      input,
      "bots",
      "list_user_project_bots",
      botRegistrations,
    );
  }

  async createUserProjectBot(
    input: CreateUserProjectBotInput,
  ): Promise<BotRegistration> {
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    const botPlatform = required(input.botPlatform, "botPlatform");
    const applicationId = required(
      String(input.applicationId),
      "applicationId",
    );
    const credential = required(input.credential, "credential");
    const raw = await this.post<{ bot_registration?: unknown }>(
      this.ownedProjectPath(projectId, "bots", params),
      {
        platform: botPlatform,
        application_id: Number(applicationId),
        label: input.label,
        credential,
        thread_mode: input.threadMode,
      },
      "create_user_project_bot",
      bearer,
    );
    await this.audit("create_user_project_bot", input.actor, { projectId });
    return camelBotRegistration(raw.bot_registration);
  }

  async deleteUserProjectBot(input: DeleteUserProjectBotInput): Promise<void> {
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    const botId = required(input.botId, "botId");
    await this.del<unknown>(
      this.ownedProjectPath(
        projectId,
        `bots/${encodeURIComponent(botId)}`,
        params,
      ),
      "delete_user_project_bot",
      bearer,
    );
    await this.audit("delete_user_project_bot", input.actor, { projectId });
  }

  async listUserBots(input: BuilderBotsInput): Promise<BotRegistration[]> {
    return this.userGet(input, "bots", "list_user_bots", botRegistrations);
  }

  async createUserBot(input: CreateUserBotInput): Promise<BotRegistration> {
    const { params, bearer } = this.userParams(input);
    const credential = required(input.credential, "credential");
    const raw = await this.post<{ bot_registration?: unknown }>(
      this.userPath("bots", params),
      {
        platform: required(input.botPlatform, "botPlatform"),
        application_ids: input.applicationIds,
        primary_application_id: input.primaryApplicationId,
        label: input.label,
        credential,
        thread_mode: input.threadMode,
      },
      "create_user_bot",
      bearer,
    );
    await this.audit("create_user_bot", input.actor);
    return camelBotRegistration(raw.bot_registration);
  }

  async updateUserBot(input: UpdateUserBotInput): Promise<BotRegistration> {
    const { params, bearer } = this.userParams(input);
    const raw = await this.patch<{ bot_registration?: unknown }>(
      this.userPath(
        `bots/${encodeURIComponent(required(input.botId, "botId"))}`,
        params,
      ),
      {
        application_ids: input.applicationIds,
        primary_application_id: input.primaryApplicationId,
        label: input.label,
        thread_mode: input.threadMode,
      },
      "update_user_bot",
      bearer,
    );
    await this.audit("update_user_bot", input.actor);
    return camelBotRegistration(raw.bot_registration);
  }

  async deleteUserBot(input: DeleteUserBotInput): Promise<void> {
    const { params, bearer } = this.userParams(input);
    await this.del<unknown>(
      this.userPath(
        `bots/${encodeURIComponent(required(input.botId, "botId"))}`,
        params,
      ),
      "delete_user_bot",
      bearer,
    );
    await this.audit("delete_user_bot", input.actor);
  }

  /** All builder-owned model keys with their grants (funder-ladder app
   *  rung). Names/prefixes/grants only — key material is write-only. */
  async listBuilderModelKeys(
    input: BuilderModelKeysInput,
  ): Promise<BuilderModelKey[]> {
    const { params, bearer } = this.builderKeyRequest(input);
    const raw = await this.get<{ keys?: unknown[] }>(
      this.userPath("model-keys", params),
      "list_builder_model_keys",
      bearer,
    );
    await this.audit("list_builder_model_keys", input.actor, {
      platform: input.platform,
    });
    return (raw.keys ?? []).map(camelBuilderModelKey);
  }

  /** Create (no `keyId`) or rotate (`keyId` set) a builder model key. */
  async saveBuilderModelKey(
    input: SaveBuilderModelKeyInput,
  ): Promise<BuilderModelKey> {
    const { params, bearer } = this.builderKeyRequest(input);
    const provider = required(input.provider, "provider");
    const key = required(input.key, "key");
    const body = { provider, key, label: input.label };
    const raw =
      input.keyId === undefined
        ? await this.post<{ key?: unknown }>(
            this.userPath("model-keys", params),
            body,
            "save_builder_model_key",
            bearer,
          )
        : await this.put<{ key?: unknown }>(
            this.userPath(
              `model-keys/${encodeURIComponent(String(input.keyId))}`,
              params,
            ),
            body,
            "save_builder_model_key",
            bearer,
          );
    await this.audit("save_builder_model_key", input.actor, {
      platform: input.platform,
    });
    return camelBuilderModelKey(raw.key);
  }

  async deleteBuilderModelKey(
    input: DeleteBuilderModelKeyInput,
  ): Promise<void> {
    const { params, bearer } = this.builderKeyRequest(input);
    const keyId = required(String(input.keyId), "keyId");
    await this.del<unknown>(
      this.userPath(`model-keys/${encodeURIComponent(keyId)}`, params),
      "delete_builder_model_key",
      bearer,
    );
    await this.audit("delete_builder_model_key", input.actor, {
      platform: input.platform,
    });
  }

  /** Replace a key's grant set ("apply to projects"). */
  async setModelKeyGrants(
    input: SetModelKeyGrantsInput,
  ): Promise<BuilderModelKey> {
    const { params, bearer } = this.builderKeyRequest(input);
    const keyId = required(String(input.keyId), "keyId");
    const raw = await this.put<{ key?: unknown }>(
      this.userPath(`model-keys/${encodeURIComponent(keyId)}/grants`, params),
      { application_ids: input.applicationIds },
      "set_model_key_grants",
      bearer,
    );
    await this.audit("set_model_key_grants", input.actor, {
      platform: input.platform,
    });
    return camelBuilderModelKey(raw.key);
  }

  async listUserProjectTransactions(
    input: ListUserProjectTransactionsInput,
  ): Promise<OperateTransactionsResult> {
    return this.ownedGet(
      input,
      "transactions",
      "list_user_project_transactions",
      camelOperateTransactions,
      (params) => {
        setLimit(params, input.limit);
        if (input.status?.trim()) params.set("status", input.status.trim());
        const cursor = encodeTransactionCursor(input.cursor);
        if (cursor) params.set("cursor", cursor);
      },
    );
  }

  async getUserProjectUsage(
    input: GetUserProjectUsageInput,
  ): Promise<OperateUsageResult> {
    return this.ownedGet(
      input,
      "usage",
      "get_user_project_usage",
      camelOperateUsage,
      (params) => setDateRange(params, input),
    );
  }

  async getUserProjectStatement(
    input: GetUserProjectUsageInput,
  ): Promise<OperateStatementResult> {
    return this.ownedGet(
      input,
      "statement",
      "get_user_project_statement",
      camelOperateStatement,
      (params) => setDateRange(params, input),
    );
  }

  async listUserProjectLogs(
    input: ListUserProjectLogsInput,
  ): Promise<OperateLogsResult> {
    return this.ownedGet(
      input,
      "logs",
      "list_user_project_logs",
      camelOperateLogs,
      (params) => {
        setLimit(params, input.limit);
        if (input.type?.trim()) params.set("type", input.type.trim());
        const cursor = encodeLogCursor(input.cursor);
        if (cursor) params.set("cursor", cursor);
      },
    );
  }

  async getUserProjectObservability(
    input: OwnedOperateProjectInput,
  ): Promise<OperateObservabilityResult> {
    return this.ownedGet(
      input,
      "observability",
      "get_user_project_observability",
      camelOperateObservability,
    );
  }

  /**
   * Account-wide observability batch: every owned project in one request,
   * each entry in the exact shape of {@link getUserProjectObservability}. The
   * manager resolves each project under its own bound platform —
   * partner-bound projects included.
   */
  async getUserObservability(
    input: GetUserObservabilityInput,
  ): Promise<OperateObservabilitySnapshot[]> {
    return this.userGet(
      input,
      "observability",
      "get_user_observability",
      (raw) =>
        ((raw.results ?? []) as Record<string, unknown>[]).map((entry) => {
          const { payments: _payments, ...snapshot } =
            camelOperateObservability(entry);
          return snapshot;
        }),
    );
  }

  async getUserPayments(
    input: GetUserPaymentsInput,
  ): Promise<OperatePaymentProjectResult[]> {
    return this.userGet(
      input,
      "payments",
      "get_user_payments",
      (raw) =>
        ((raw.results ?? []) as Record<string, unknown>[]).map((entry) => ({
          project: camelProject(entry.project),
          payments: camelPartnerPayments(entry.payments),
        })),
      undefined,
      { projectId: input.projectId },
    );
  }

  /**
   * Account-wide transactions batch: one newest-first page merged across
   * every owned project, with a single global cursor.
   */
  async listUserTransactions(
    input: ListUserTransactionsInput,
  ): Promise<UserTransactionsResult> {
    return this.userGet(
      input,
      "transactions",
      "list_user_transactions",
      (raw) => ({
        projects: camelUserProjectRefs(raw.projects),
        transactions: ((raw.transactions ?? []) as Record<string, any>[]).map(
          (row) => ({
            ...camelTransactionRow(row),
            projectId: optNumber(row.project_id ?? row.projectId),
            platform: optString(row.platform),
          }),
        ),
        nextCursor: camelTransactionCursor(raw.next_cursor ?? raw.nextCursor),
      }),
      (params) => {
        setLimit(params, input.limit);
        if (input.status?.trim()) params.set("status", input.status.trim());
        const cursor = encodeTransactionCursor(input.cursor);
        if (cursor) params.set("cursor", cursor);
      },
    );
  }

  /**
   * Account-wide statement batch: every owned source in one request, each
   * entry in the exact shape of {@link getUserProjectStatement}.
   */
  async getUserStatements(
    input: GetUserStatementsInput,
  ): Promise<OperateStatementResult[]> {
    return this.userGet(
      input,
      "statement",
      "get_user_statement",
      (raw) =>
        ((raw.results ?? []) as Record<string, unknown>[]).map((entry) =>
          camelOperateStatement(entry),
        ),
      (params) => setDateRange(params, input),
    );
  }

  /**
   * Account-wide usage batch: every owned source in one request, each entry
   * in the exact shape of {@link getUserProjectUsage}.
   */
  async getUserUsage(
    input: GetUserStatementsInput,
  ): Promise<OperateUsageResult[]> {
    return this.userGet(
      input,
      "usage",
      "get_user_usage",
      (raw) =>
        ((raw.results ?? []) as Record<string, unknown>[]).map((entry) =>
          camelOperateUsage(entry),
        ),
      (params) => setDateRange(params, input),
    );
  }

  /**
   * Account-wide logs batch: one newest-first page of the merged log stream
   * across every owned source, with a single global cursor. Shared partner
   * settlements carry a null `projectId`.
   */
  async listUserLogs(input: ListUserLogsInput): Promise<UserLogsResult> {
    return this.userGet(
      input,
      "logs",
      "list_user_logs",
      (raw) => ({
        projects: camelUserProjectRefs(raw.projects),
        logs: ((raw.logs ?? []) as Record<string, any>[]).map((row) => ({
          ...camelLogRow(row),
          projectId: optNumber(row.project_id ?? row.projectId),
          platform: optString(row.platform),
        })),
        nextCursor: camelLogCursor(raw.next_cursor ?? raw.nextCursor),
        invocationsAvailable: raw.invocations_available !== false,
      }),
      (params) => {
        setLimit(params, input.limit);
        if (input.type?.trim()) params.set("type", input.type.trim());
        const cursor = encodeLogCursor(input.cursor);
        if (cursor) params.set("cursor", cursor);
      },
    );
  }

  async getBuilderApplicationDetail(
    input: GetBuilderApplicationDetailInput,
  ): Promise<OperateAppDetailResult> {
    const applicationId = required(
      String(input.applicationId),
      "applicationId",
    );
    const githubUserId = required(input.githubUserId, "githubUserId");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({ github_user_id: githubUserId });
    const raw = await this.get<Record<string, unknown>>(
      this.builderPath(
        `applications/${encodeURIComponent(applicationId)}/detail`,
        params,
      ),
      "get_builder_application_detail",
      bearer,
    );
    await this.audit("get_builder_application_detail", input.actor, {
      applicationId: input.applicationId,
    });
    return camelOperateAppDetail(raw);
  }

  async upgradeUserProjectSdk(
    input: OwnedOperateProjectInput,
  ): Promise<ProjectSdkUpgradeResult> {
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    const raw = await this.post<Record<string, unknown>>(
      this.ownedProjectPath(projectId, "sdk-upgrade", params),
      {},
      "upgrade_user_project_sdk",
      bearer,
    );
    await this.audit("upgrade_user_project_sdk", input.actor, { projectId });
    const status = raw.status;
    const requiredSdkVersion = String(raw.required_sdk_version ?? "");
    const sourceRef = String(raw.source_ref ?? "");
    if (status === "current") {
      return { status, requiredSdkVersion, sourceRef };
    }
    if (status === "pull_request") {
      const pullRequest = responseRecord(raw.pull_request, "pull_request");
      return {
        status,
        requiredSdkVersion,
        sourceRef,
        branch: String(raw.branch ?? ""),
        files: Array.isArray(raw.files) ? raw.files.map(String) : [],
        pullRequest: {
          number: Number(pullRequest.number),
          url: String(pullRequest.url ?? ""),
          created: Boolean(pullRequest.created),
        },
      };
    }
    if (status === "manual") {
      return {
        status,
        requiredSdkVersion,
        sourceRef,
        reason: String(raw.reason ?? "SDK upgrade requires a local change."),
        command: String(raw.command ?? ""),
      };
    }
    throw new DeployError(
      "BACKEND",
      "backend returned an unknown source SDK upgrade status",
    );
  }

  /**
   * Read the merge state of the `aomi/sdk-<required>` upgrade PR with one
   * GitHub-backed call — the cheap counterpart to {@link upgradeUserProjectSdk},
   * safe to poll. No repo tarball, no branch mutation.
   */
  async sdkUpgradeStatus(
    input: OwnedOperateProjectInput,
  ): Promise<ProjectSdkUpgradeStatusResult> {
    return this.ownedGet(
      input,
      "sdk-upgrade-status",
      "get_project_sdk_upgrade_status",
      (raw) => {
        const status = raw.status;
        if (
          status !== "merged" &&
          status !== "open" &&
          status !== "closed" &&
          status !== "none"
        ) {
          throw new DeployError(
            "BACKEND",
            "backend returned an unknown source SDK upgrade status",
          );
        }
        const pr =
          raw.pull_request && typeof raw.pull_request === "object"
            ? (raw.pull_request as Record<string, unknown>)
            : null;
        return {
          status,
          requiredSdkVersion: String(raw.required_sdk_version ?? ""),
          branch: String(raw.branch ?? ""),
          pullRequest: pr
            ? {
                number: Number(pr.number),
                url: String(pr.url ?? ""),
                state: String(pr.state ?? ""),
                merged: Boolean(pr.merged),
              }
            : null,
        };
      },
    );
  }
}
