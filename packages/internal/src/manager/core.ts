import { BackendError, BrowserEnvironmentError, DeployError } from "@aomi-labs/deploy";
import type {
  AuditEvent,
  BuilderModelKeysInput,
  BackendClientOptions,
  OwnedOperateProjectInput,
} from "@aomi-labs/deploy";
import { required } from "@aomi-labs/deploy/wire";

/**
 * Transport tier of the deploy client: bearer resolution, raw HTTP, audit
 * forwarding, and the shared request-shaping helpers. One public client is
 * split across three inheritance tiers for file size:
 * core -> platform -> user (one folder, one public class).
 */
export class BackendClientCore {
  private readonly opts: BackendClientOptions;
  private readonly baseUrl: string;
  /** Activation token for deploy/activate/status and bootstrap reads. */
  private readonly activationToken?: string;
  /** Privileged admin/service bearer for bootstrap writes (token minting). */
  private readonly adminBearer?: string;
  private readonly fetchImpl: NonNullable<BackendClientOptions["fetch"]>;

  constructor(opts: BackendClientOptions) {
    assertServerOnly();
    this.opts = opts;
    this.baseUrl = required(opts.aomi.backendUrl, "aomi.backendUrl").replace(
      /\/+$/,
      "",
    );
    this.activationToken = opts.aomi.activationToken?.trim() || undefined;
    this.adminBearer = opts.aomi.adminBearer?.trim() || undefined;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /**
   * Pick the bearer for a call: an explicit per-call override wins; otherwise
   * privileged writes prefer the admin bearer, everything else the activation
   * token. Throws a typed error (no network call) when neither is configured.
   */
  protected resolveBearer(
    override?: string,
    opts?: { privileged?: boolean },
  ): string {
    const order = opts?.privileged
      ? [override, this.adminBearer, this.activationToken]
      : [override, this.activationToken, this.adminBearer];
    const found = order.map((t) => t?.trim()).find(Boolean);
    if (!found) {
      throw new DeployError(
        "INVALID_REQUEST",
        opts?.privileged
          ? "this operation needs a privileged admin/service bearer (aomi.adminBearer) or an activation token"
          : "this operation needs an activation token (aomi.activationToken)",
      );
    }
    return found;
  }

  endpoint(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  protected ownedOperateRequest(input: OwnedOperateProjectInput): {
    projectId: number;
    params: URLSearchParams;
    bearer: string;
  } {
    const githubUserId = required(input.githubUserId, "githubUserId");
    const projectId = Number(input.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new DeployError(
        "INVALID_REQUEST",
        "operate project reads require a positive projectId",
      );
    }
    return {
      projectId,
      bearer: this.resolveBearer(input.bearer),
      params: new URLSearchParams({ github_user_id: githubUserId }),
    };
  }

  /** `/api/integrations/github-app/user/<suffix>?…` */
  protected userPath(pathSuffix: string, params: URLSearchParams): string {
    return `/api/integrations/github-app/user/${pathSuffix}?${params.toString()}`;
  }

  /** `/api/integrations/github-app/builder/<suffix>?…` */
  protected builderPath(pathSuffix: string, params: URLSearchParams): string {
    return `/api/integrations/github-app/builder/${pathSuffix}?${params.toString()}`;
  }

  /** `/api/integrations/github-app/user/projects/:id/<suffix>?…` */
  protected ownedProjectPath(
    projectId: number | string,
    pathSuffix: string,
    params: URLSearchParams,
  ): string {
    return this.userPath(
      `projects/${encodeURIComponent(String(projectId))}/${pathSuffix}`,
      params,
    );
  }

  protected ownedProjectBasePath(
    projectId: number | string,
    params: URLSearchParams,
  ): string {
    return this.userPath(
      `projects/${encodeURIComponent(String(projectId))}`,
      params,
    );
  }

  /** Shared interior of the owned-project operate reads: GET
   *  `/user/projects/:id/<suffix>`, audit `action`, map the body.
   *  Strict: `projectId` must be a positive safe integer. */
  protected async ownedGet<T>(
    input: OwnedOperateProjectInput,
    pathSuffix: string,
    action: AuditEvent["action"],
    map: (raw: Record<string, unknown>) => T,
    extraParams?: (params: URLSearchParams) => void,
  ): Promise<T> {
    const { projectId, params, bearer } = this.ownedOperateRequest(input);
    extraParams?.(params);
    const raw = await this.get<Record<string, unknown>>(
      this.ownedProjectPath(projectId, pathSuffix, params),
      action,
      bearer,
    );
    await this.audit(action, input.actor, { projectId });
    return map(raw);
  }

  /**
   * Same path/audit shape as {@link ownedGet}, but with the loose projectId
   * check (`required(String(id))` only). Kept for the three non-operate
   * project reads that intentionally never ran the positive-int gate.
   */
  protected async ownedGetLoose<T>(
    input: {
      githubUserId: string;
      projectId: number;
      bearer?: string;
      actor?: string;
    },
    pathSuffix: string,
    action: AuditEvent["action"],
    map: (raw: Record<string, unknown>) => T,
    extraParams?: (params: URLSearchParams) => void,
  ): Promise<T> {
    const githubUserId = required(input.githubUserId, "githubUserId");
    const projectId = required(String(input.projectId), "projectId");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({ github_user_id: githubUserId });
    extraParams?.(params);
    const raw = await this.get<Record<string, unknown>>(
      this.ownedProjectPath(projectId, pathSuffix, params),
      action,
      bearer,
    );
    await this.audit(action, input.actor, { projectId: input.projectId });
    return map(raw);
  }

  /** Params + bearer for the account-scoped `/user/*` routes. `projectId`,
   *  when present, becomes the optional `project_id` narrowing param. */
  protected userParams(input: {
    githubUserId: string;
    bearer?: string;
    projectId?: number;
  }): { params: URLSearchParams; bearer: string } {
    const githubUserId = required(input.githubUserId, "githubUserId");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({ github_user_id: githubUserId });
    if (input.projectId !== undefined) {
      if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
        throw new Error("projectId must be a positive integer");
      }
      params.set("project_id", String(input.projectId));
    }
    return { params, bearer };
  }

  /** Shared interior of the account-wide reads: GET `/user/<suffix>`, audit
   *  `action` (plus `auditExtra`), map the body. */
  protected async userGet<T>(
    input: {
      githubUserId: string;
      bearer?: string;
      actor?: string;
      projectId?: number;
      visibilityGrant?: string;
    },
    pathSuffix: string,
    action: AuditEvent["action"],
    map: (raw: Record<string, unknown>) => T,
    extraParams?: (params: URLSearchParams) => void,
    auditExtra?: Omit<AuditEvent, "action" | "actor" | "ts">,
  ): Promise<T> {
    const { params, bearer } = this.userParams(input);
    extraParams?.(params);
    const raw = await this.get<Record<string, unknown>>(
      this.userPath(pathSuffix, params),
      action,
      bearer,
      input.visibilityGrant?.trim()
        ? { "X-Aomi-Visibility-Grant": input.visibilityGrant.trim() }
        : undefined,
    );
    await this.audit(action, input.actor, auditExtra);
    return map(raw);
  }

  protected builderKeyRequest(input: BuilderModelKeysInput): {
    params: URLSearchParams;
    bearer: string;
  } {
    const githubUserId = required(input.githubUserId, "githubUserId");
    const platform = required(input.platform, "platform");
    const bearer = this.resolveBearer(input.bearer);
    const params = new URLSearchParams({
      github_user_id: githubUserId,
      platform,
    });
    return { params, bearer };
  }

  protected get<Resp>(
    path: string,
    operation: string,
    bearer: string,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    return this.request<Resp>(path, "GET", undefined, operation, bearer, headers);
  }

  protected post<Resp>(
    path: string,
    body: unknown,
    operation: string,
    bearer: string,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    return this.request<Resp>(path, "POST", body, operation, bearer, headers);
  }

  protected patch<Resp>(
    path: string,
    body: unknown,
    operation: string,
    bearer: string,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    return this.request<Resp>(path, "PATCH", body, operation, bearer, headers);
  }

  protected put<Resp>(
    path: string,
    body: unknown,
    operation: string,
    bearer: string,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    return this.request<Resp>(path, "PUT", body, operation, bearer, headers);
  }

  protected del<Resp>(
    path: string,
    operation: string,
    bearer: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    return this.request<Resp>(path, "DELETE", body, operation, bearer, headers);
  }

  private async request<Resp>(
    path: string,
    method: string,
    body: unknown,
    operation: string,
    bearer: string,
    headers?: Record<string, string>,
  ): Promise<Resp> {
    const url = this.endpoint(path);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...headers,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new BackendError(
        operation,
        0,
        `${operation} request failed`,
        undefined,
        { cause: err },
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new BackendError(
        operation,
        res.status,
        `${operation} failed (${res.status})`,
        text,
      );
    }
    if (!text.trim()) return null as Resp;
    try {
      return JSON.parse(text) as Resp;
    } catch (error) {
      throw new BackendError(
        operation,
        res.status,
        `${operation} returned invalid JSON`,
        text,
        { cause: error },
      );
    }
  }

  /** Forward one audit event to the configured sink, stamped now. */
  protected async audit(
    action: AuditEvent["action"],
    actor: string | undefined,
    extra?: Omit<AuditEvent, "action" | "actor" | "ts">,
  ): Promise<void> {
    if (this.opts.onAudit) {
      await this.opts.onAudit({ action, ...extra, actor, ts: Date.now() });
    }
  }
}

export function assertServerOnly(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__AOMI_ALLOW_BROWSER__ === true) return;
  if (
    typeof (g as { window?: unknown }).window !== "undefined" &&
    typeof (g as { document?: unknown }).document !== "undefined"
  ) {
    throw new BrowserEnvironmentError(
      "@aomi-labs/deploy is server-only: it holds the activation token and " +
        "must never run in a browser. Import it from a server route handler.",
    );
  }
}
