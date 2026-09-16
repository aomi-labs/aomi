import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const appNodeModules = path.join(appRoot, "node_modules");
const portalSrc = path.join(appRoot, "src");
const accountSrc = path.join(workspaceRoot, "packages/account/src");
const widgetSrc = path.join(workspaceRoot, "apps/shadcn-registry/src");

const emptyModulePath = path.join(appRoot, "empty-module.js");
const nobleHashesAssertCompatPath = path.join(
  appRoot,
  "noble-hashes-assert-compat.js",
);

// Portal-local code should import from `@portal/*`.
// These `@/components|hooks|lib` aliases exist only so registry source imported
// through `@aomi-labs/widget-lib` can resolve its own internal paths.
const widgetTurbopackAliases = {
  "@/components": "../../apps/shadcn-registry/src/components",
  "@/hooks": "../../apps/shadcn-registry/src/hooks",
  "@/lib": "../../apps/shadcn-registry/src/lib",
  "@aomi-labs/widget-lib/providers/para":
    "../../apps/shadcn-registry/src/lib/wallet-kit/providers/para/index.ts",
  "@aomi-labs/widget-lib/providers/privy":
    "../../apps/shadcn-registry/src/lib/wallet-kit/providers/privy/index.ts",
  "@aomi-labs/widget-lib": "../../apps/shadcn-registry/src/index.ts",
} as const;

// Keep these in sync with the corresponding `paths` entries in
// `apps/portal/tsconfig.json`.
const widgetWebpackAliases = {
  "@/components": path.join(widgetSrc, "components"),
  "@/hooks": path.join(widgetSrc, "hooks"),
  "@/lib": path.join(widgetSrc, "lib"),
  "@aomi-labs/widget-lib/providers/para": path.join(
    widgetSrc,
    "lib/wallet-kit/providers/para/index.ts",
  ),
  "@aomi-labs/widget-lib/providers/privy": path.join(
    widgetSrc,
    "lib/wallet-kit/providers/privy/index.ts",
  ),
  "@aomi-labs/widget-lib": path.join(widgetSrc, "index.ts"),
} as const;

const nextConfig: NextConfig = {
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
  // Hide the dev-tools indicator when recording demo takes. It renders a
  // badge in the bottom-left corner, directly on top of the account chip,
  // and reads on camera as "this product has N issues". Opt-in via env so
  // normal local development keeps the indicator.
  ...(process.env.AOMI_HIDE_DEV_INDICATOR === "true"
    ? { devIndicators: false as const }
    : {}),
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
    "@aomi-labs/bff-observability",
    "@aomi-labs/client",
    "@aomi-labs/react",
    "@aomi-labs/widget-lib",
    "@getpara/react-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "@portal": "./src",
      ...widgetTurbopackAliases,
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
      "@portal": portalSrc,
      ...widgetWebpackAliases,
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
