import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const appNodeModules = path.join(appRoot, "node_modules");
const buildSrc = path.join(appRoot, "src");

const emptyModulePath = path.join(appRoot, "empty-module.js");
const nobleHashesAssertCompatPath = path.join(
  appRoot,
  "noble-hashes-assert-compat.js",
);

function defaultBackendUrl() {
  if (process.env.VERCEL_ENV === "preview") {
    return "https://api-staging.aomi.dev";
  }
  if (process.env.VERCEL_ENV === "production") {
    return "https://api.aomi.dev";
  }
  return "http://127.0.0.1:8080";
}

// Aomi Build-local code should import from `@/*`.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BACKEND_URL:
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      defaultBackendUrl(),
    NEXT_PUBLIC_ANVIL_URL:
      process.env.NEXT_PUBLIC_ANVIL_URL ||
      process.env.ANVIL_URL ||
      "http://127.0.0.1:8545",
    NEXT_PUBLIC_SUPPORTED_CHAIN_IDS:
      process.env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS || "",
  },
  // Lets a second local instance run from the same checkout (multi-instance
  // testing of the stateless BFF); default .next otherwise.
  distDir: process.env.NEXT_DIST_DIR || undefined,
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  outputFileTracingRoot: workspaceRoot,
  // The service-topology TOML is read at runtime via a dynamic path, so
  // @vercel/nft can't trace it automatically — include it explicitly for every
  // route that mints/verifies a bearer. Per the Next docs, include-glob values
  // resolve from the Next.js project root (apps/build), NOT from
  // outputFileTracingRoot.
  outputFileTracingIncludes: {
    "/*": [
      "./service.portal.toml",
      "./service.portal.staging.toml",
      "./service.portal.production.toml",
    ],
  },
  experimental: {
    externalDir: true,
    webpackMemoryOptimizations: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const backendProxyTarget = process.env.AOMI_BACKEND_PROXY_TARGET;
    if (!backendProxyTarget) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${backendProxyTarget}/api/:path*`,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // aomi-smither and its smithers-orchestrator runtime ship Bun-flavored
  // projects; the Node loader hooks in src/instrumentation.ts load them at
  // runtime, so keep them out of the server bundle entirely.
  serverExternalPackages: ["@aomi-labs/smither", "smithers-orchestrator"],
  transpilePackages: [
    "@aomi-labs/account",
    "@aomi-labs/observability",
    "@aomi-labs/client",
    "@aomi-labs/deploy",
    "@aomi-labs/react",
    "@aomi-labs/widget",
    "@getpara/react-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "@": "./src",

      "@aomi-labs/account/observability":
        "../../packages/account/src/observability.ts",
      "@aomi-labs/account": "../../packages/account/src/index.ts",
      "@aomi-labs/client": "../../packages/client/src/index.ts",
      "@aomi-labs/deploy": "../../packages/deploy/src/index.ts",
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
      "@": buildSrc,

      "@aomi-labs/account/observability": path.join(
        workspaceRoot,
        "packages/account/src/observability.ts",
      ),
      "@aomi-labs/account": path.join(
        workspaceRoot,
        "packages/account/src/index.ts",
      ),
      "@aomi-labs/client": path.join(
        workspaceRoot,
        "packages/client/src/index.ts",
      ),
      "@aomi-labs/deploy": path.join(
        workspaceRoot,
        "packages/deploy/src/index.ts",
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
const sentryRelease = sentryGitSha ? `build-bff@${sentryGitSha}` : undefined;
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
