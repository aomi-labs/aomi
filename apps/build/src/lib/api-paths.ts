// Aomi Build API paths, shared by the app and its tests.
//
// Isomorphic — imported by client call sites, server route handlers, and tests.
// The Edge serves the control plane; the Build server owns sandbox runs and
// integrations. Backend-contract paths remain owned by their Rust services.

const BUILD_API = "/api/build";

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
  build: {
    auth: {
      github: {
        login: `${BUILD_API}/auth/github/login`,
        callback: `${BUILD_API}/auth/github/callback`,
        status: `${BUILD_API}/auth/github/status`,
        signout: `${BUILD_API}/auth/github/signout`,
        devSession: `${BUILD_API}/auth/github/dev-session`,
      },
    },
    cli: {
      login: `${BUILD_API}/cli/login`,
      exchange: `${BUILD_API}/cli/exchange`,
      status: `${BUILD_API}/cli/status`,
    },
    deployments: {
      preflight: `${BUILD_API}/deployments/preflight`,
      deploy: `${BUILD_API}/deployments/deploy`,
      redeploy: `${BUILD_API}/deployments/redeploy`,
      promote: `${BUILD_API}/deployments/promote`,
      projects: (platform?: string, projectId?: number) =>
        withPlatform(
          projectsPath(`${BUILD_API}/deployments/projects`, projectId),
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
        return `${BUILD_API}/deployments/feed?${params}`;
      },
      history: (projectId: number, limit?: number, platform?: string) => {
        const params = new URLSearchParams({
          projectId: String(projectId),
        });
        if (limit) params.set("limit", String(limit));
        if (platform) params.set("platform", platform);
        return `${BUILD_API}/deployments/history?${params}`;
      },
      sdkStatus: `${BUILD_API}/deployments/sdk-status`,
      status: (deploymentId: string, platform?: string) =>
        withPlatform(
          `${BUILD_API}/deployments/status?deploymentId=${encodeURIComponent(deploymentId)}`,
          platform,
        ),
      requiredSecrets: (projectId: number, platform?: string) =>
        withPlatform(
          `${BUILD_API}/deployments/required-secrets?projectId=${projectId}`,
          platform,
        ),
      records: (app: string, projectId?: number, platform?: string) =>
        withPlatform(
          `${BUILD_API}/deployments/records?app=${encodeURIComponent(app)}${
            projectId != null ? `&projectId=${projectId}` : ""
          }`,
          platform,
        ),
      deactivate: `${BUILD_API}/deployments/deactivate`,
      sdkUpgrade: `${BUILD_API}/deployments/sdk-upgrade`,
      sdkUpgradeStatus: (projectId: number, platform?: string) =>
        withPlatform(
          `${BUILD_API}/deployments/sdk-upgrade-status?projectId=${projectId}`,
          platform,
        ),
    },
    operate: {
      bots: `${BUILD_API}/operate/bots`,
      botCommandSecret: (botId: string) =>
        `${BUILD_API}/operate/bots/${encodeURIComponent(botId)}/command-secret`,
      botWebhook: (botId: string) =>
        `${BUILD_API}/operate/bots/${encodeURIComponent(botId)}/webhook`,
      modelKeys: `${BUILD_API}/operate/model-keys`,
      transactions: `${BUILD_API}/operate/transactions`,
      usage: `${BUILD_API}/operate/usage`,
      logs: `${BUILD_API}/operate/logs`,
      observability: `${BUILD_API}/operate/observability`,
      payments: `${BUILD_API}/operate/payments`,
      observabilityDetail: (applicationId: number) => {
        const params = new URLSearchParams({
          applicationId: String(applicationId),
        });
        return `${BUILD_API}/operate/observability/detail?${params}`;
      },
    },
    integrations: {
      base: `${BUILD_API}/integrations`,
    },
    e2e: {
      execute: "/api/dev/e2e/execute",
      wallet: "/api/dev/e2e/wallet",
    },
  },
} as const;
