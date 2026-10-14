import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const appNodeModules = path.join(appRoot, "node_modules");
const portalSrc = path.join(appRoot, "src");
const accountSrc = path.join(workspaceRoot, "packages/account/src");
const managedBuildJobs = Number(process.env.AOMI_DEV_BUILD_JOBS);
const managedBuildCpus =
  Number.isInteger(managedBuildJobs) && managedBuildJobs > 0
    ? managedBuildJobs
    : undefined;

const emptyModulePath = path.join(appRoot, "empty-module.js");
const nobleHashesAssertCompatPath = path.join(
  appRoot,
  "noble-hashes-assert-compat.js",
);

const buildOrigin = new URL(
  process.env.AOMI_BUILD_URL || "https://build.aomi.dev",
).origin;

const nextConfig: NextConfig = {
  distDir: process.env.AOMI_PORTAL_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/deployments/new",
        destination: `${buildOrigin}/operate/deployments/new`,
        permanent: false,
      },
      {
        source: "/deployments/:projectId",
        destination: `${buildOrigin}/projects/:projectId`,
        permanent: false,
      },
      {
        source: "/deployments",
        destination: `${buildOrigin}/projects`,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/oauth/bootstrap",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
  // Keep the development badge clear of the account and sign-in controls.
  // Demo recordings may hide it entirely.
  ...(process.env.AOMI_HIDE_DEV_INDICATOR === "true"
    ? { devIndicators: false as const }
    : { devIndicators: { position: "bottom-right" as const } }),
  env: {
    NEXT_PUBLIC_BACKEND_URL:
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      "http://127.0.0.1:8080",
    NEXT_PUBLIC_ANVIL_URL:
      process.env.NEXT_PUBLIC_ANVIL_URL ||
      process.env.ANVIL_URL ||
      "http://127.0.0.1:8545",
    NEXT_PUBLIC_SUPPORTED_CHAIN_IDS:
      process.env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS || "",
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  },
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    ...(managedBuildCpus ? { cpus: managedBuildCpus } : {}),
    externalDir: true,
    webpackMemoryOptimizations: true,
  },
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@aomi-labs/account",
    "@aomi-labs/observability",
    "@aomi-labs/client",
    "@aomi-labs/react",
    "@aomi-labs/widget",
    "@getpara/react-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "@": "./src",

      "@aomi-labs/account/account": "../../packages/account/src/account.ts",
      "@aomi-labs/account/better-auth":
        "../../packages/account/src/better-auth/index.ts",
      "@aomi-labs/account/observability":
        "../../packages/account/src/observability.ts",
      "@aomi-labs/account/providers":
        "../../packages/account/src/providers/index.ts",
      "@aomi-labs/account": "../../packages/account/src/index.ts",
      "@aomi-labs/client": "../../packages/client/src/index.ts",
      "@aomi-labs/react": "../../packages/react/src/index.ts",
      "@assistant-ui/react": "./node_modules/@assistant-ui/react",
      "@noble/hashes/_assert": "./noble-hashes-assert-compat.js",
      "@tanstack/react-query": "./node_modules/@tanstack/react-query",
      "@farcaster/miniapp-sdk": "./empty-module.js",
      "@farcaster/mini-app-solana": "./empty-module.js",
      "@farcaster/miniapp-wagmi-connector": "./empty-module.js",
      "@getpara/ethers-v6-integration": "./empty-module.js",
      "pino-pretty": "./empty-module.js",
      viem: "./node_modules/viem",
      wagmi: "./node_modules/wagmi",
      zustand: "./node_modules/zustand",
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": portalSrc,

      "@aomi-labs/account/account": path.join(accountSrc, "account.ts"),
      "@aomi-labs/account/better-auth": path.join(
        accountSrc,
        "better-auth/index.ts",
      ),
      "@aomi-labs/account/observability": path.join(
        accountSrc,
        "observability.ts",
      ),
      "@aomi-labs/account/providers": path.join(
        accountSrc,
        "providers/index.ts",
      ),
      "@aomi-labs/account": path.join(accountSrc, "index.ts"),
      "@aomi-labs/client": path.join(
        workspaceRoot,
        "packages/client/src/index.ts",
      ),
      "@aomi-labs/react": path.join(
        workspaceRoot,
        "packages/react/src/index.ts",
      ),
      "@assistant-ui/react": path.join(appNodeModules, "@assistant-ui/react"),
      "@noble/hashes/_assert": nobleHashesAssertCompatPath,
      "@tanstack/react-query": path.join(
        appNodeModules,
        "@tanstack/react-query",
      ),
      "@farcaster/miniapp-sdk": emptyModulePath,
      "@farcaster/mini-app-solana": emptyModulePath,
      "@farcaster/miniapp-wagmi-connector": emptyModulePath,
      "@getpara/ethers-v6-integration": emptyModulePath,
      "pino-pretty": false,
      viem: path.join(appNodeModules, "viem"),
      wagmi: path.join(appNodeModules, "wagmi"),
      zustand: path.join(appNodeModules, "zustand"),
    };

    return config;
  },
};

const sentryEnvironment = process.env.SENTRY_ENVIRONMENT;
const sentryGitSha =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
const sentryRelease = sentryGitSha ? `portal-bff@${sentryGitSha}` : undefined;
const sentryBuildEnabled =
  process.env.SENTRY_ENABLED === "1" &&
  (sentryEnvironment === "staging" || sentryEnvironment === "production") &&
  process.env.SENTRY_PROJECT === "aomi-bff" &&
  Boolean(process.env.SENTRY_ORG) &&
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  Boolean(sentryRelease);

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: {
    name: sentryRelease,
    create: sentryBuildEnabled,
    finalize: sentryBuildEnabled,
  },
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: !sentryBuildEnabled,
    deleteSourcemapsAfterUpload: true,
  },
});
