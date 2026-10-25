import { BackendError, DeployError } from "@aomi-labs/deploy";
import type {
  ActivateInput,
  ActivateResult,
  CreateProjectInput,
  DeactivateApplicationInput,
  DeployInput,
  DeployResult,
  DeploymentProgressEvent,
  DeploymentStatus,
  IngestSecretsInput,
  IngestSecretsResult,
  ListAppSecretsInput,
  ListDeploymentRecordsInput,
  ListDeploymentRecordsResult,
  ListSecretsInput,
  ListSecretsResult,
  ListTokensInput,
  MintTokenInput,
  MintedToken,
  PreflightInput,
  Project,
  PromoteInput,
  PromoteResult,
  RemoveAppSecretInput,
  RerunDeploymentInput,
  RerunDeploymentResult,
  RevokeTokenInput,
  ScaffoldInput,
  ServerTagsResult,
  StatusInput,
  TokenRecord,
  WatchDeploymentOptions,
} from "@aomi-labs/deploy";
import { watchDeploymentLoop } from "@aomi-labs/deploy/launch";
import {
  activateRequest,
  camelActivateResult,
  camelDeployResult,
  camelProject,
  camelStatusResult,
  camelTokenRecord,
  deployRequest,
  required,
  timestampSeconds,
} from "@aomi-labs/deploy/wire";
import { BackendClientCore } from "./core";

/**
 * Platform/admin tier of the deploy client: Project-scoped deployment plus
 * the `/api/platforms/*` result, activation, token, and bootstrap surfaces
 * plus the secrets vault. See core.ts for the tier layout.
 */
export class BackendPlatformClient extends BackendClientCore {
  /** `/api/platforms/:platform/<suffix>` */
  private platformPath(platform: string, suffix: string): string {
    return `/api/platforms/${encodeURIComponent(platform)}/${suffix}`;
  }

  /** `?k=v&…` for defined non-empty entries; skips null/undefined/"". */
  private qs(
    entries: Record<string, string | number | null | undefined>,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
      if (value == null || value === "") continue;
      params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  private positiveInt(value: unknown, message: string): number {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new DeployError("INVALID_REQUEST", message);
    }
    return n;
  }

  /** Stable Application identity plus manifest name for handle labels. */
  private appSecretsBody(input: {
    applicationId: number;
    app: string;
  }): Record<string, unknown> {
    return {
      application_id: this.positiveInt(
        input.applicationId,
        "applicationId must be a positive integer",
      ),
      app: required(input.app, "app"),
    };
  }

  private async secretsByApp(
    path: string,
    bearer: string,
  ): Promise<ListSecretsResult> {
    const raw = await this.get<{ by_app?: Record<string, string[]> }>(
      path,
      "list_secrets",
      bearer,
    );
    return { byApp: raw.by_app ?? {} };
  }

  async preflight(input: PreflightInput): Promise<DeployResult> {
    return this.runDeploy(input, "preflight");
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    return this.runDeploy(input, "deploy");
  }

  /** Shared deploy POST — preflight (advisory) and deploy (apply) differ only
   *  in the request flag and the audited action. */
  private async runDeploy(
    input: PreflightInput | DeployInput,
    action: "preflight" | "deploy",
  ): Promise<DeployResult> {
    const projectId = this.positiveInt(
      input.projectId,
      "deploy requires a positive projectId",
    );
    const body = deployRequest(input, action === "preflight");
    const result = await this.post<DeployResult>(
      `/api/projects/${projectId}/deploy`,
      body,
      action,
      this.resolveBearer(),
    );
    const cameled = camelDeployResult(result);
    if (!cameled.ok) {
      throw new DeployError(
        "BACKEND",
        `${action} rejected by backend (deployment ${cameled.deployment.id})`,
      );
    }
    await this.audit(action, input.actor, {
      projectId,
    });
    return cameled;
  }

  async activate(input: ActivateInput): Promise<ActivateResult> {
    const platform = required(input.platform, "platform");
    const body = activateRequest(input);
    const result = await this.post<ActivateResult>(
      this.platformPath(platform, "apps/activate"),
      body,
      "activation",
      this.resolveBearer(),
    );
    const cameled = camelActivateResult(result);
    if (!cameled.ok) {
      const partialErrors = cameled.activation.apps
        .filter((a) => a.error)
        .map((a) => ({ app: a.name, error: a.error }));
      throw new DeployError(
        "ACTIVATION",
        `activate rejected by backend (status ${cameled.activation.status})`,
        partialErrors.length ? partialErrors : undefined,
      );
    }
    await this.audit("activate", input.actor, {
      platform,
      apps: input.apps ?? [],
      targetTags: input.targetTags,
    });
    return cameled;
  }

  /** Deactivate one app: clears its live pointer and unloads the binary. The
   *  deployment's git record and activation history are untouched. */
  async deactivateApplication(
    input: DeactivateApplicationInput,
  ): Promise<void> {
    const platform = required(input.platform, "platform");
    if (
      !Number.isSafeInteger(input.applicationId) ||
      input.applicationId <= 0
    ) {
      throw new DeployError(
        "INVALID_REQUEST",
        "deactivate requires a positive applicationId",
      );
    }
    await this.post<unknown>(
      this.platformPath(
        platform,
        `applications/${encodeURIComponent(String(input.applicationId))}/deactivate`,
      ),
      {},
      "deactivate",
      this.resolveBearer(input.bearer),
    );
    await this.audit("deactivate", input.actor, {
      platform,
      applicationId: input.applicationId,
      apps: input.app ? [input.app] : undefined,
    });
  }

  /**
   * Promote a recorded deployment to live through the one activation door:
   * `POST /api/platforms/:platform/apps/activate` with a `deployment` target
   * (`apps` filters the deployment's apps; empty = all). Replaces the retired
   * v1 `/deployments/:id/promote` route.
   */
  async promote(input: PromoteInput): Promise<PromoteResult> {
    const platform = required(input.platform, "platform");
    const deploymentId = required(input.deploymentId, "deploymentId");
    const result = await this.post<ActivateResult>(
      this.platformPath(platform, "apps/activate"),
      {
        target: { kind: "deployment", value: deploymentId },
        ...(input.apps?.length ? { apps: input.apps } : {}),
        ...(input.targetTags?.length ? { target_tags: input.targetTags } : {}),
        ...(input.actor ? { actor: input.actor } : {}),
      },
      "promote",
      this.resolveBearer(),
    );
    await this.audit("promote", input.actor, {
      platform,
      apps: input.apps ?? [],
      targetTags: input.targetTags,
    });
    const cameled = camelActivateResult(result);
    const releaseTags = cameled.activation.apps
      .map((app) => app.releaseTag)
      .filter((tag): tag is string => Boolean(tag));
    return {
      ok: cameled.ok,
      promote: {
        deploymentId,
        releaseTags,
        status: cameled.ok ? "promoted" : "blocked",
        activation: cameled.activation,
      },
    };
  }

  /**
   * POST `/api/platforms/:platform/deployments/:id/rerun` — re-run the GitHub
   * Actions run behind a deployment's recorded commit. The backend's App
   * installation token makes the GitHub call; clients hold no GitHub token.
   */
  async rerunDeployment(
    input: RerunDeploymentInput,
  ): Promise<RerunDeploymentResult> {
    const platform = required(input.platform, "platform");
    const deploymentId = required(input.deploymentId, "deploymentId");
    const result = await this.post<Record<string, unknown>>(
      this.platformPath(
        platform,
        `deployments/${encodeURIComponent(deploymentId)}/rerun`,
      ) + this.qs({ github_user_id: input.githubUserId?.trim() || undefined }),
      {},
      "rerun",
      this.resolveBearer(),
    );
    await this.audit("rerun", input.actor, { platform });
    return {
      ok: result.ok === true,
      deploymentId,
      commitHash:
        typeof result.commit_hash === "string" ? result.commit_hash : null,
      runId: typeof result.run_id === "number" ? result.run_id : null,
      ciUrl: typeof result.ci_url === "string" ? result.ci_url : null,
    };
  }

  async status(input: StatusInput): Promise<DeploymentStatus> {
    const platform = required(input.platform, "platform");
    const githubQuery = this.qs({
      github_user_id: input.githubUserId?.trim() || undefined,
    });
    const path = input.deploymentId
      ? this.platformPath(
          platform,
          `deployments/${encodeURIComponent(input.deploymentId)}/status${githubQuery}`,
        )
      : (input.path ?? this.platformPath(platform, "status"));
    const result = await this.get<Record<string, unknown>>(
      path,
      "status",
      this.resolveBearer(),
    );
    await this.audit("status", input.actor, { platform });
    return camelStatusResult(result);
  }

  async serverTags(): Promise<ServerTagsResult> {
    const result = await this.get<Record<string, unknown>>(
      "/api/platforms/server-tags",
      "server tags",
      this.resolveBearer(),
    );
    return {
      serverTags: (result.server_tags ?? result.serverTags ?? []) as string[],
      sdkVersion: String(result.sdk_version ?? result.sdkVersion ?? ""),
      ffiVersion: (result.ffi_version ?? result.ffiVersion ?? null) as number | null,
      ffiInterfaces: (result.ffi_interfaces ?? result.ffiInterfaces ?? []) as string[],
    };
  }

  /**
   * Poll GET /api/platforms/:platform/deployments/:id/status until a terminal
   * state is reached or retries are exhausted. Calls onEvent for every tick.
   */
  async watchDeployment(
    deploymentId: string,
    platform: string,
    onEvent: (event: DeploymentProgressEvent) => void,
    options?: WatchDeploymentOptions,
  ): Promise<void> {
    return watchDeploymentLoop(
      () => this.status({ platform, deploymentId }),
      onEvent,
      {
        ...options,
        // A 4xx is the backend telling us this will never succeed.
        isFatal: (err) =>
          err instanceof BackendError && err.status >= 400 && err.status < 500,
      },
    );
  }

  // ───────────────────────── Bootstrap: tokens ──────────────────────────────

  /**
   * Mint a platform or app activation token.
   * `POST /api/platforms/:platform/tokens`.
   *
   * The plaintext token is returned ONCE — store it now; the backend keeps only
   * its hash. Minting the first platform token needs the privileged admin
   * bearer (`aomi.adminBearer` or `input.bearer`); a platform token may then
   * mint app-scoped tokens.
   */
  async mintToken(input: MintTokenInput): Promise<MintedToken> {
    const platform = required(input.platform, "platform");
    if (input.scope !== "platform" && input.scope !== "app") {
      throw new DeployError(
        "INVALID_REQUEST",
        `scope must be "platform" or "app" (got ${JSON.stringify(input.scope)})`,
      );
    }
    const body: Record<string, unknown> = { scope: input.scope };
    if (input.scope === "app") {
      body.app_id = this.positiveInt(
        input.appId,
        'scope "app" requires a positive appId',
      );
    }
    const bearer = this.resolveBearer(input.bearer, { privileged: true });
    const raw = await this.post<Record<string, unknown>>(
      this.platformPath(platform, "tokens"),
      body,
      "mint_token",
      bearer,
    );
    await this.audit("mint_token", input.actor, {
      platform,
      scope: input.scope,
    });
    return {
      id: Number(raw.id),
      token: String(raw.token),
      scope: (raw.scope as string) ?? input.scope,
    };
  }

  /** List a platform's activation tokens. `GET /api/platforms/:platform/tokens`. */
  async listTokens(input: ListTokensInput): Promise<TokenRecord[]> {
    const platform = required(input.platform, "platform");
    const bearer = this.resolveBearer(input.bearer);
    const raw = await this.get<unknown>(
      this.platformPath(platform, "tokens"),
      "list_tokens",
      bearer,
    );
    await this.audit("list_tokens", input.actor, { platform });
    return (Array.isArray(raw) ? raw : []).map(camelTokenRecord);
  }

  /** Revoke a token by id. `DELETE /api/platforms/:platform/tokens/:id`. */
  async revokeToken(input: RevokeTokenInput): Promise<boolean> {
    const platform = required(input.platform, "platform");
    const id = this.positiveInt(input.id, "revokeToken requires a positive id");
    const bearer = this.resolveBearer(input.bearer, { privileged: true });
    const raw = await this.del<unknown>(
      this.platformPath(platform, `tokens/${id}`),
      "revoke_token",
      bearer,
    );
    await this.audit("revoke_token", input.actor, { platform, tokenId: id });
    return raw === true;
  }

  // ─────────────────────────── Bootstrap: projects ──────────────────────────

  /**
   * Create the platform-bound project for an installed GitHub repository.
   * The backend validates `.aomi/config.json` before persisting it.
   */
  async createProject(input: CreateProjectInput): Promise<Project> {
    const platform = required(input.platform, "platform");
    const repo = required(input.repo, "repo");
    const bearer = this.resolveBearer(input.bearer);
    const raw = await this.post<{ ok?: boolean; project?: unknown }>(
      this.platformPath(platform, "projects"),
      {
        repo,
        github_user_id: required(input.githubUserId, "githubUserId"),
      },
      "create_project",
      bearer,
    );
    await this.audit("create_project", input.actor, { platform, repo });
    return camelProject(raw.project);
  }

  /**
   * One-shot: create a new repo from a template and persist its project.
   * `POST /api/integrations/github-app/platforms/:platform/projects/create-from-template`.
   */
  async scaffold(input: ScaffoldInput): Promise<Project> {
    const platform = required(input.platform, "platform");
    const installationId = this.positiveInt(
      input.installationId,
      "scaffold requires a positive installationId",
    );
    const repoName = required(input.repoName, "repoName");
    const templateRepo = required(input.templateRepo, "templateRepo");
    const githubUserId = required(input.githubUserId, "githubUserId");
    const bearer = this.resolveBearer(input.bearer);
    const raw = await this.post<{ ok?: boolean; project?: unknown }>(
      `/api/integrations/github-app/platforms/${encodeURIComponent(platform)}/projects/create-from-template`,
      {
        installation_id: installationId,
        template_repo: templateRepo,
        repo_name: repoName,
        github_user_id: githubUserId,
        private: Boolean(input.private),
      },
      "scaffold",
      bearer,
    );
    await this.audit("scaffold", input.actor, { platform, repo: repoName });
    return camelProject(raw.project);
  }

  // ──────────────────────── Bootstrap: platform apps ────────────────────────

  /** List loaded apps on a platform. `GET /api/platforms/:platform/apps`. */
  async listDeploymentRecords(
    input: ListDeploymentRecordsInput,
  ): Promise<ListDeploymentRecordsResult> {
    const platform = required(input.platform, "platform");
    const app = required(input.app, "app");
    const raw = await this.get<{
      app?: string;
      current_release_tag?: string | null;
      records?: Array<Record<string, unknown>>;
    }>(
      this.platformPath(platform, `apps/${encodeURIComponent(app)}/records`) +
        this.qs({ project_id: input.projectId }),
      "list_deployment_records",
      this.resolveBearer(input.bearer),
    );
    return {
      app: raw.app ?? app,
      currentReleaseTag: (raw.current_release_tag as string | null) ?? null,
      records: (raw.records ?? []).map((row) => ({
        deploymentId: String(row.deployment_id ?? ""),
        releaseTag: String(row.release_tag ?? ""),
        actor: (row.actor as string | null) ?? null,
        createdAt: timestampSeconds(row.created_at),
        sdkVersion: (row.sdk_version as string | null) ?? null,
        current: Boolean(row.current),
      })),
    };
  }

  async listSecrets(input: ListSecretsInput = {}): Promise<ListSecretsResult> {
    return this.secretsByApp(
      `/api/secrets${this.qs({ client_id: input.clientId ?? input.githubUserId })}`,
      this.resolveBearer(input.bearer, { privileged: true }),
    );
  }

  /** Ingest Environment values for one canonical Application. Service op. */
  async ingestSecrets(input: IngestSecretsInput): Promise<IngestSecretsResult> {
    const raw = await this.post<{ handles?: Record<string, string> }>(
      `/api/_internal/secrets`,
      { ...this.appSecretsBody(input), secrets: input.secrets },
      "ingest_secrets",
      this.resolveBearer(input.bearer, { privileged: true }),
    );
    return { handles: raw.handles ?? {} };
  }

  /** List vault handle names (never values) for one Application. */
  async listAppSecrets(input: ListAppSecretsInput): Promise<ListSecretsResult> {
    return this.secretsByApp(
      `/api/_internal/secrets${this.qs({
        application_id: this.positiveInt(
          input.applicationId,
          "applicationId must be a positive integer",
        ),
      })}`,
      this.resolveBearer(input.bearer, { privileged: true }),
    );
  }

  /** Remove one app-scoped secret. Service op. Returns whether it existed. */
  async removeAppSecret(input: RemoveAppSecretInput): Promise<boolean> {
    // Validate the full body (name included) before resolving the bearer, so
    // a bad input never reads as "missing bearer".
    const body = {
      application_id: this.positiveInt(
        input.applicationId,
        "applicationId must be a positive integer",
      ),
      name: required(input.name, "name"),
    };
    const raw = await this.del<{ removed?: boolean }>(
      `/api/_internal/secrets`,
      "ingest_secrets",
      this.resolveBearer(input.bearer, { privileged: true }),
      body,
    );
    return Boolean(raw.removed);
  }
}
