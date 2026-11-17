// Aomi Build API paths, shared by the app and its tests.
//
// Isomorphic — imported by client call sites, server route handlers, and tests.
// The Edge serves the control plane; the Build server owns sandbox runs and
// integrations. Backend-contract paths remain owned by their Rust services.

const BUILD_API = "/api/build";

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
    publisher: `${BUILD_API}/publishers/me`,
    agent: (name: string) => `${BUILD_API}/agents/${encodeURIComponent(name)}`,
    agentConfigs: (name: string) =>
      `${BUILD_API}/agents/${encodeURIComponent(name)}/configs`,
    agentPromote: (name: string) =>
      `${BUILD_API}/agents/${encodeURIComponent(name)}/promote`,
    package: (name: string) =>
      `${BUILD_API}/packages/${encodeURIComponent(name)}`,
    packageReleases: (name: string) =>
      `${BUILD_API}/packages/${encodeURIComponent(name)}/releases`,
    packagePromote: (name: string) =>
      `${BUILD_API}/packages/${encodeURIComponent(name)}/promote`,
    packageSecret: (name: string, slot: string) =>
      `${BUILD_API}/packages/${encodeURIComponent(name)}/secrets/${encodeURIComponent(slot)}`,
    keys: `${BUILD_API}/keys`,
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
