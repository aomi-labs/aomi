// Single source of truth for Aomi Build BFF route paths.
//
// Isomorphic — imported by client call sites, server route handlers, and tests.
// Boundary rule: every path under `/api/bff/*` is served by an app-local route
// handler; any other `/api/*` path is forwarded to the Rust backend by the
// `[...slug]` proxy. Backend-contract paths
// (e.g. `/api/integrations/github-app/oauth/start`) deliberately live outside
// this registry — they are owned by the backend, not Aomi Build.

const BFF = "/api/bff";

function withPlatform(path: string, platform?: string): string {
  if (!platform) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}platform=${encodeURIComponent(platform)}`;
}

// Project read, optionally narrowed server-side to one Project.
function projectsPath(base: string, projectId?: number): string {
  return projectId === undefined ? base : `${base}?projectId=${projectId}`;
}

export const API_PATHS = {
  bff: {
    auth: {
      github: {
        login: `${BFF}/auth/github/login`,
        callback: `${BFF}/auth/github/callback`,
        status: `${BFF}/auth/github/status`,
        signout: `${BFF}/auth/github/signout`,
        devSession: `${BFF}/auth/github/dev-session`,
      },
    },
    cli: {
      login: `${BFF}/cli/login`,
      exchange: `${BFF}/cli/exchange`,
      status: `${BFF}/cli/status`,
    },
    deployments: {
      preflight: `${BFF}/deployments/preflight`,
      deploy: `${BFF}/deployments/deploy`,
      redeploy: `${BFF}/deployments/redeploy`,
      promote: `${BFF}/deployments/promote`,
      projects: (platform?: string, projectId?: number) =>
        withPlatform(
          projectsPath(`${BFF}/deployments/projects`, projectId),
          platform,
        ),
      feed: (
        limit: number,
        cursor?: { createdAt: number; id: number } | null,
      ) => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) {
          params.set("cursorCreatedAt", String(cursor.createdAt));
          params.set("cursorId", String(cursor.id));
        }
        return `${BFF}/deployments/feed?${params}`;
      },
      history: (projectId: number, limit?: number, platform?: string) => {
        const params = new URLSearchParams({
          projectId: String(projectId),
        });
        if (limit) params.set("limit", String(limit));
        if (platform) params.set("platform", platform);
        return `${BFF}/deployments/history?${params}`;
      },
      sdkStatus: `${BFF}/deployments/sdk-status`,
      status: (deploymentId: string, platform?: string) =>
        withPlatform(
          `${BFF}/deployments/status?deploymentId=${encodeURIComponent(deploymentId)}`,
          platform,
        ),
      requiredSecrets: (projectId: number, platform?: string) =>
        withPlatform(
          `${BFF}/deployments/required-secrets?projectId=${projectId}`,
          platform,
        ),
      records: (app: string, projectId?: number, platform?: string) =>
        withPlatform(
          `${BFF}/deployments/records?app=${encodeURIComponent(app)}${
            projectId != null ? `&projectId=${projectId}` : ""
          }`,
          platform,
        ),
      deactivate: `${BFF}/deployments/deactivate`,
      sdkUpgrade: `${BFF}/deployments/sdk-upgrade`,
      sdkUpgradeStatus: (projectId: number, platform?: string) =>
        withPlatform(
          `${BFF}/deployments/sdk-upgrade-status?projectId=${projectId}`,
          platform,
        ),
    },
    operate: {
      bots: `${BFF}/operate/bots`,
      botCommandSecret: (botId: string) =>
        `${BFF}/operate/bots/${encodeURIComponent(botId)}/command-secret`,
      botWebhook: (botId: string) =>
        `${BFF}/operate/bots/${encodeURIComponent(botId)}/webhook`,
      modelKeys: `${BFF}/operate/model-keys`,
      transactions: `${BFF}/operate/transactions`,
      usage: `${BFF}/operate/usage`,
      logs: `${BFF}/operate/logs`,
      observability: `${BFF}/operate/observability`,
      payments: `${BFF}/operate/payments`,
      observabilityDetail: (applicationId: number) => {
        const params = new URLSearchParams({
          applicationId: String(applicationId),
        });
        return `${BFF}/operate/observability/detail?${params}`;
      },
    },
    integrations: {
      base: `${BFF}/integrations`,
    },
    e2e: {
      execute: `${BFF}/e2e/execute`,
      wallet: `${BFF}/e2e/wallet`,
    },
  },
} as const;
