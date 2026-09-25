// =============================================================================
// createLaunchClient — the browser seam of the launch flow.
//
// Talks only to the host's same-origin BFF (`createLaunchRoutes` +
// `createGitHubAuthRoutes` mounts); the GitHub session cookie and the
// activation/service bearer stay server-side.
//
// Two mounts, two shapes: the launch flow (`/api/bff/launch/*`) sits on the
// client itself, the project console (`/api/bff/deployments/*`) under
// `.deployments`. They are different handlers, not aliases, so the namespace
// says which one you are calling instead of a `deployment` name prefix.
// =============================================================================

import type {
  DeploymentFeedResult,
  DeploymentHistoryResult,
  DeploymentPromoteResult,
  DeploymentSecretsResult,
  DeploymentProjectsResult,
  LaunchActivateResult,
  LaunchAppStatusesResult,
  LaunchCreateRepoResult,
  LaunchDeployInput,
  LaunchDeployResult,
  LaunchPreflightInput,
  LaunchRedeployResult,
  LaunchSdkStatus,
  LaunchStatus,
  RequiredSecretsResult,
} from "./contracts";
import type {
  DeploymentProgressEvent,
  GitHubAppInstallationsResult,
  ListDeploymentRecordsResult,
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
} from "../types";
import { normalizeRepo } from "./state";
import { watchDeploymentLoop, type WatchLoopOptions } from "./watch";
import type { UserProject } from "../types";

export type { UserProject };

export const DEFAULT_LAUNCH_BASE_PATH = "/api/bff/launch";
export const DEFAULT_DEPLOYMENTS_BASE_PATH = "/api/bff/deployments";
export const DEFAULT_GITHUB_AUTH_BASE_PATH = "/api/bff/auth/github";

/**
 * Every launch BFF route returns the payload on success or `{ error }` on
 * failure; this carries the status and body so hosts can branch on them
 * (e.g. 404 from an exact-platform lookup means "no such platform").
 */
export class LaunchRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "LaunchRequestError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Whether retrying this request could plausibly succeed.
 *
 * Defaults to true: only a BFF that explicitly says otherwise (a missing
 * deploy-time credential, say) should have its Retry affordance withdrawn.
 */
export function isRetryableLaunchError(error: unknown): boolean {
  if (!(error instanceof LaunchRequestError)) return true;
  const body = error.body;
  if (!body || typeof body !== "object") return true;
  const retryable = (body as { retryable?: unknown }).retryable;
  return typeof retryable === "boolean" ? retryable : true;
}

/** Browser request failures that polling cannot recover from. */
export function isFatalLaunchRequestError(error: unknown): boolean {
  return (
    error instanceof LaunchRequestError &&
    error.status >= 400 &&
    error.status < 500
  );
}

export interface GitHubSessionInfo {
  signedIn: boolean;
  githubLogin: string | null;
  githubAvatarUrl?: string | null;
  /** Present when the one-shot App is already installed (skip-install). */
  installationId?: string | null;
}

export interface UserProjectsResult {
  projects: UserProject[];
  githubLogin: string | null;
}

export type GithubAppOAuthStartResponse = {
  ok: boolean;
  install_url?: string;
};

export type LaunchClientOptions = {
  /** Where `createLaunchRoutes` is mounted. Default `/api/bff/launch`. */
  basePath?: string;
  /** Where the deployments console routes are mounted. Default `/api/bff/deployments`. */
  deploymentsBasePath?: string;
  /** Where `createGitHubAuthRoutes` is mounted. Default `/api/bff/auth/github`. */
  authBasePath?: string;
  /**
   * The platform for calls made BEFORE a project exists — project creation,
   * the wizard's status polls, and explicit platform-filtered lists. A
   * partner integration binds its exact platform here once. Project-scoped
   * calls never send a platform: the BFF derives the project's bound one.
   */
  platform?: string;
  /**
   * Fetch that reaches the Aomi backend (for `githubAppInstallUrl`, which calls
   * `/api/integrations/github-app/oauth/start`). Hosts running the widget
   * proxy pass a same-origin fetcher here; defaults to a plain same-origin
   * `fetch` that JSON-parses and throws `{ error }` on non-2xx.
   */
  backendFetch?: <T>(path: string) => Promise<T>;
  /** Custom fetch (tests, SSR). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
};

function createBaseClient(options: LaunchClientOptions) {
  const basePath = (options.basePath ?? DEFAULT_LAUNCH_BASE_PATH).replace(
    /\/+$/,
    "",
  );
  const deploymentsPath = (
    options.deploymentsBasePath ?? DEFAULT_DEPLOYMENTS_BASE_PATH
  ).replace(/\/+$/, "");
  const authBasePath = (
    options.authBasePath ?? DEFAULT_GITHUB_AUTH_BASE_PATH
  ).replace(/\/+$/, "");
  const doFetch: typeof fetch =
    options.fetch ?? ((...args) => globalThis.fetch(...args));
  const boundPlatform = options.platform?.trim() || undefined;

  // Every launch BFF route returns the payload on success or `{ error }` on
  // failure. Centralize that contract so each call site stays a one-liner.
  async function launchFetch<T>(
    path: string,
    label: string,
    init?: RequestInit,
  ): Promise<T> {
    const res = await doFetch(path, init);
    const json = (await res.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!res.ok) {
      throw new LaunchRequestError(
        json.error || `${label} failed (${res.status})`,
        res.status,
        json,
      );
    }
    return json;
  }

  /** A call's own platform wins; otherwise the client's bound one. */
  function platformOf(explicit?: string): string | undefined {
    return explicit?.trim() || boundPlatform;
  }

  /** Same, for a request body that carries `platform` to the BFF. */
  function withPlatform<T extends { platform?: string }>(input: T): T {
    const platform = platformOf(input.platform);
    return platform ? { ...input, platform } : input;
  }

  function query(
    parts: Record<string, string | number | undefined>,
    platform?: string,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parts)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const resolved = platformOf(platform);
    if (resolved) params.set("platform", resolved);
    const search = `${params}`;
    return search ? `?${search}` : "";
  }

  /**
   * Project-scoped query: never carries a platform. The BFF derives the
   * bound platform from the project row, so sending one here would only
   * reintroduce the wrong-platform default this refactor removes.
   */
  function projectQuery(
    parts: Record<string, string | number | undefined>,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parts)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const search = `${params}`;
    return search ? `?${search}` : "";
  }

  function postJson<T>(
    path: string,
    label: string,
    input: unknown,
  ): Promise<T> {
    return launchFetch<T>(path, label, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  const backendFetch =
    options.backendFetch ??
    (<T>(path: string) => launchFetch<T>(path, "backend request"));

  function status(input: {
    deploymentId: string;
    platform?: string;
  }): Promise<LaunchStatus> {
    return launchFetch(
      `${basePath}/status${query({ deploymentId: input.deploymentId }, input.platform)}`,
      "launch status",
    );
  }

  /** The project console — `/api/bff/deployments/*`. */
  const deployments = {
    projects(
      input: { platform?: string; projectId?: number } = {},
    ): Promise<DeploymentProjectsResult> {
      return launchFetch(
        `${deploymentsPath}/projects${query({ projectId: input.projectId }, input.platform)}`,
        "deployment projects",
      );
    },

    status(input: {
      deploymentId: string;
      platform?: string;
    }): Promise<LaunchStatus> {
      return launchFetch(
        `${deploymentsPath}/status${query({ deploymentId: input.deploymentId }, input.platform)}`,
        "deployment status",
      );
    },

    upgradeSdk(input: { projectId: number }): Promise<ProjectSdkUpgradeResult> {
      return postJson(
        `${deploymentsPath}/sdk-upgrade`,
        "project SDK upgrade",
        input,
      );
    },

    sdkUpgradeStatus(input: {
      projectId: number;
    }): Promise<ProjectSdkUpgradeStatusResult> {
      return launchFetch(
        `${deploymentsPath}/sdk-upgrade-status${projectQuery({ projectId: input.projectId })}`,
        "project SDK upgrade status",
      );
    },

    /** GitHub App access for the signed-in builder's connected repositories. */
    githubAppInstallations(): Promise<GitHubAppInstallationsResult> {
      return launchFetch(
        `${deploymentsPath}/github-app`,
        "GitHub App installations",
      );
    },

    history(input: {
      projectId: number;
      limit?: number;
    }): Promise<DeploymentHistoryResult> {
      return launchFetch(
        `${deploymentsPath}/history${projectQuery({ projectId: input.projectId, limit: input.limit })}`,
        "deployment history",
      );
    },

    /** Activity feed for the selected platform. */
    feed(
      input: {
        platform?: string;
        limit?: number;
        cursor?: DeploymentFeedResult["nextCursor"];
      } = {},
    ): Promise<DeploymentFeedResult> {
      const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
      if (input.platform?.trim()) {
        params.set("platform", input.platform.trim());
      }
      if (input.cursor) {
        params.set("cursorCreatedAt", String(input.cursor.createdAt));
        params.set("cursorId", String(input.cursor.id));
      }
      return launchFetch(
        `${deploymentsPath}/feed?${params}`,
        "deployment feed",
      );
    },

    secrets(input: {
      applicationId: number;
    }): Promise<DeploymentSecretsResult> {
      return launchFetch(
        `${deploymentsPath}/secrets?applicationId=${encodeURIComponent(String(input.applicationId))}`,
        "deployment secrets",
      );
    },

    requiredSecrets(input: {
      projectId: number;
    }): Promise<RequiredSecretsResult> {
      return launchFetch(
        `${deploymentsPath}/required-secrets${projectQuery({ projectId: input.projectId })}`,
        "required secrets",
      );
    },

    setSecrets(input: {
      applicationId: number;
      secrets: Record<string, string>;
    }): Promise<{ ok: boolean; keys: string[] }> {
      return postJson(
        `${deploymentsPath}/secrets`,
        "set environment variables",
        input,
      );
    },

    deleteSecret(input: {
      applicationId: number;
      name: string;
    }): Promise<{ ok: boolean; removed: boolean }> {
      return launchFetch(
        `${deploymentsPath}/secrets`,
        "delete environment variable",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
    },

    records(input: {
      /** Only meaningful without `projectId`; a project's records derive
       *  their platform from the project row. */
      platform?: string;
      app: string;
      projectId?: number;
    }): Promise<ListDeploymentRecordsResult> {
      return launchFetch(
        input.projectId !== undefined
          ? `${deploymentsPath}/records${projectQuery({ app: input.app, projectId: input.projectId })}`
          : `${deploymentsPath}/records${query({ app: input.app }, input.platform)}`,
        "deployment records",
      );
    },

    promote(input: {
      deploymentId: string;
      projectId: number;
      apps?: string[];
      actor?: string;
    }): Promise<DeploymentPromoteResult> {
      return postJson(
        `${deploymentsPath}/promote`,
        "deployment promote",
        input,
      );
    },

    deactivate(input: {
      projectId: number;
      apps: string[];
    }): Promise<{ ok: boolean; apps: string[] }> {
      return postJson(
        `${deploymentsPath}/deactivate`,
        "deployment deactivate",
        input,
      );
    },
  };

  return {
    /** Where the "Sign in with GitHub" button points. */
    githubSigninUrl: `${authBasePath}/login`,

    /** The platform bound at construction, if any. */
    platform: boundPlatform,

    preflight(input: LaunchPreflightInput): Promise<LaunchDeployResult> {
      return postJson(`${basePath}/preflight`, "launch preflight", input);
    },

    deploy(input: LaunchDeployInput): Promise<LaunchDeployResult> {
      return postJson(`${basePath}/deploy`, "launch deploy", input);
    },

    redeploy(input: { projectId: number }): Promise<LaunchRedeployResult> {
      return postJson(`${basePath}/redeploy`, "launch redeploy", input);
    },

    createRepo(input: {
      platform?: string;
      installationId: string;
      repoName?: string;
    }): Promise<LaunchCreateRepoResult> {
      return postJson(
        `${basePath}/create`,
        "launch repo creation",
        withPlatform(input),
      );
    },

    status,

    /**
     * Poll a deployment to completion, reporting every tick.
     *
     * Never throws: a failure arrives as an `error` event, so a render loop
     * has one code path. Backs off 3s → 30s, treats a 4xx as fatal, and
     * cancels via `options.signal`.
     */
    watch(
      input: { deploymentId: string; platform?: string },
      onEvent: (event: DeploymentProgressEvent) => void,
      watchOptions: WatchLoopOptions = {},
    ): Promise<void> {
      return watchDeploymentLoop(() => status(input), onEvent, {
        isFatal: isFatalLaunchRequestError,
        ...watchOptions,
      });
    },

    /**
     * SDK version status. The launch and deployments mounts serve this from
     * the same handler, so there is one method.
     */
    sdkStatus(): Promise<LaunchSdkStatus> {
      return launchFetch(`${basePath}/sdk-status`, "launch SDK status");
    },

    activate(input: {
      projectId: number;
      releaseTags: string[];
      apps?: string[];
      actor?: string;
    }): Promise<LaunchActivateResult> {
      return postJson(`${basePath}/activate`, "launch activation", input);
    },

    appStatuses(input: {
      projectId: number;
    }): Promise<LaunchAppStatusesResult> {
      const params = new URLSearchParams({
        projectId: String(input.projectId),
      });
      return launchFetch(`${basePath}/apps?${params}`, "launch app statuses");
    },

    async fetchGitHubSession(): Promise<GitHubSessionInfo> {
      try {
        const res = await doFetch(`${authBasePath}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return { signedIn: false, githubLogin: null };
        return (await res.json()) as GitHubSessionInfo;
      } catch {
        return { signedIn: false, githubLogin: null };
      }
    },

    async signOutGitHub(): Promise<void> {
      await doFetch(`${authBasePath}/signout`, { method: "POST" });
    },

    /** The signed-in user's projects on the launch mount. */
    async projects(): Promise<UserProjectsResult> {
      const res = await doFetch(`${basePath}/projects`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as
        | UserProjectsResult
        | { error?: string };
      if (!res.ok) {
        const message =
          "error" in json && json.error
            ? json.error
            : `failed to load projects (${res.status})`;
        throw new Error(message);
      }
      return json as UserProjectsResult;
    },

    deployments,

    /**
     * Ask the backend for the GitHub entry URL. The backend picks the
     * ceremony — OAuth consent when an installation already covers the repo,
     * the install flow otherwise — so callers never choose a mode. Reaches
     * the backend through `backendFetch` — same-origin widget proxy by default.
     */
    async githubAppInstallUrl(args: {
      platform?: string;
      repo?: string;
      mode?: "install" | "authorize";
      app?: number;
      /** Validated Aomi Build page the OAuth callback should land back on. */
      returnTo?: string;
    }): Promise<string> {
      const params = new URLSearchParams();
      const platform = platformOf(args.platform);
      if (platform) params.set("platform", platform);
      const repo = args.repo ? normalizeRepo(args.repo) : null;
      if (repo) params.set("repo", repo);
      if (args.mode === "authorize") params.set("mode", "authorize");
      if (args.app && args.app !== 1) params.set("app", String(args.app));
      const returnTo = args.returnTo?.trim();
      if (returnTo) params.set("return_to", returnTo);
      const search = params.toString();
      const result = await backendFetch<GithubAppOAuthStartResponse>(
        `/api/integrations/github-app/oauth/start${search ? `?${search}` : ""}`,
      );
      if (!result.install_url) {
        throw new Error(
          "GitHub App install URL was not returned by the backend.",
        );
      }
      return result.install_url;
    },
  };
}

type LaunchClientBase = ReturnType<typeof createBaseClient>;

export interface LaunchClient extends LaunchClientBase {
  /**
   * The same client scoped to a different platform. Cheap — switching
   * platforms is an explicit, greppable act rather than a parameter you might
   * forget on one call out of fifteen.
   */
  forPlatform(platform: string): LaunchClient;
}

export function createLaunchClient(
  options: LaunchClientOptions = {},
): LaunchClient {
  return {
    ...createBaseClient(options),
    forPlatform: (platform: string) =>
      createLaunchClient({ ...options, platform }),
  };
}
