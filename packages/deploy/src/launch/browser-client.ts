// Browser client for project reads, agent keys and GitHub sign-in.
import type {
  DeploymentProjectsResult,
  LaunchAgentStatusesResult,
} from "./contracts";
import type { GitHubAppInstallationsResult, UserProject } from "../types";
import { normalizeRepo } from "./state";

export type { UserProject };

export const DEFAULT_DEPLOYMENTS_BASE_PATH = "/api/build/deployments";
export const DEFAULT_GITHUB_AUTH_BASE_PATH = "/api/build/auth/github";

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
  /** Present when the GitHub App is already installed (skip-install). */
  installationId?: string | null;
  /** The Edge offers local dev sign-in as a test builder (local development only). */
  devSignIn?: boolean;
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
  /** Where the deployments console routes are mounted. Default `/api/build/deployments`. */
  deploymentsBasePath?: string;
  /** Where the GitHub auth routes are mounted. Default `/api/build/auth/github`. */
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

  const backendFetch =
    options.backendFetch ??
    (<T>(path: string) => launchFetch<T>(path, "backend request"));

  /** The project console — `/api/build/deployments/*`. */
  const deployments = {
    projects(
      input: { platform?: string; projectId?: number } = {},
    ): Promise<DeploymentProjectsResult> {
      return launchFetch(
        `${deploymentsPath}/projects${query({ projectId: input.projectId }, input.platform)}`,
        "deployment projects",
      );
    },
    githubAppInstallations(): Promise<GitHubAppInstallationsResult> {
      return launchFetch(
        `${deploymentsPath}/github-app`,
        "GitHub App installations",
      );
    },
  };

  return {
    githubSigninUrl: `${authBasePath}/login`,
    platform: boundPlatform,
    agentStatuses(input: {
      projectId: number;
    }): Promise<LaunchAgentStatusesResult> {
      const params = new URLSearchParams({
        projectId: String(input.projectId),
      });
      return launchFetch(
        `${deploymentsPath}/agents?${params}`,
        "launch agent statuses",
      );
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
    deployments,
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
