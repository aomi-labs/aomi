// Single source of truth for portal-owned BFF route paths.
//
// Isomorphic — imported by client call sites, server route handlers, and tests.
// Boundary rule: every path under `/api/bff/*` is served by a portal route
// handler (apps/portal/src/server/bff); any other `/api/*` path is forwarded
// to the Rust backend by the `[...slug]` proxy. Backend-contract paths
// (e.g. `/api/integrations/github-app/oauth/start`) deliberately live outside
// this registry — they are owned by the backend, not the portal.

const BFF = "/api/bff";

export const API_PATHS = {
  bff: {
    e2e: {
      execute: `${BFF}/e2e/execute`,
      solana: `${BFF}/e2e/solana`,
      wallet: `${BFF}/e2e/wallet`,
    },
  },
} as const;
