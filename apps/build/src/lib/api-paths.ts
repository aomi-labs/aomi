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
        devSignIn: `${BUILD_API}/auth/github/dev-sign-in`,
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
      channels: `${BUILD_API}/operate/channels`,
      channelCommandSecret: (channelId: string) =>
        `${BUILD_API}/operate/channels/${encodeURIComponent(channelId)}/command-secret`,
      channelWebhook: (channelId: string) =>
        `${BUILD_API}/operate/channels/${encodeURIComponent(channelId)}/webhook`,
      modelKeys: `${BUILD_API}/operate/model-keys`,
      transactions: `${BUILD_API}/operate/transactions`,
      usage: `${BUILD_API}/operate/usage`,
      logs: `${BUILD_API}/operate/logs`,
      observability: `${BUILD_API}/operate/observability`,
      payments: `${BUILD_API}/operate/payments`,
      observabilityDetail: (agentId: number) => {
        const params = new URLSearchParams({
          agentId: String(agentId),
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
