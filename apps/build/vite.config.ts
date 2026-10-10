import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = resolve(root, "../..");

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, root, "");
  for (const [name, value] of Object.entries(localEnv)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  const env = { ...localEnv, ...process.env };
  const backend =
    env.VERCEL_ENV === "production"
      ? "https://api.aomi.dev"
      : env.VERCEL_ENV === "preview"
        ? "https://api-staging.aomi.dev"
        : "http://127.0.0.1:8080";
  // Preserve deployed public names without exposing the server environment.
  const publicEnv = {
    NEXT_PUBLIC_BACKEND_URL:
      env.NEXT_PUBLIC_BACKEND_URL || env.BACKEND_URL || backend,
    NEXT_PUBLIC_ANVIL_URL:
      env.NEXT_PUBLIC_ANVIL_URL || env.ANVIL_URL || "http://127.0.0.1:8545",
    NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS || "",
    NEXT_PUBLIC_CHAT_URL: env.NEXT_PUBLIC_CHAT_URL || "",
    NEXT_PUBLIC_BUILD_ENGINE: env.NEXT_PUBLIC_BUILD_ENGINE || "",
    NEXT_PUBLIC_VERCEL_ENV: env.NEXT_PUBLIC_VERCEL_ENV || env.VERCEL_ENV || "",
  };
  const gitSha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  const release = gitSha ? `build-bff@${gitSha}` : undefined;
  const sentryEnabled =
    env.SENTRY_ENABLED === "1" &&
    ["staging", "production"].includes(env.SENTRY_ENVIRONMENT || "") &&
    env.SENTRY_PROJECT === "aomi-bff" &&
    Boolean(env.SENTRY_ORG && env.SENTRY_AUTH_TOKEN && release);
  return {
    plugins: [
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/*.server.*", "**/src/server/**"],
            specifiers: [
              "server-only",
              /^@aomi-labs\/account(?:$|\/(?!better-auth\/client))/,
            ],
          },
        },
      }),
      nitro({
        preset: env.VERCEL === "1" ? "vercel" : "node-server",
        traceDeps: ["@aomi-labs/smither*", "smithers-orchestrator*"],
      }),
      react(),
      sentryTanstackStart({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: {
          name: release,
          create: sentryEnabled,
          finalize: sentryEnabled,
        },
        sourcemaps: {
          disable: !sentryEnabled,
          filesToDeleteAfterUpload: [
            "./dist/**/*.map",
            "./.output/**/*.map",
            "./.vercel/output/**/*.map",
          ],
        },
        autoInstrumentMiddleware: false,
        telemetry: false,
        silent: true,
      }),
    ],
    define: Object.fromEntries(
      Object.entries(publicEnv).map(([name, value]) => [
        `process.env.${name}`,
        JSON.stringify(value),
      ]),
    ),
    resolve: {
      alias: [
        {
          find: /^server-only$/,
          replacement: "@tanstack/react-start/server-only",
        },
        { find: "@", replacement: resolve(root, "src") },
        {
          find: "@noble/hashes/_assert",
          replacement: resolve(root, "noble-hashes-assert-compat.js"),
        },
        ...[
          "@farcaster/miniapp-sdk",
          "@farcaster/mini-app-solana",
          "@farcaster/miniapp-wagmi-connector",
          "@getpara/ethers-v6-integration",
          "pino-pretty",
        ].map((find) => ({
          find,
          replacement: resolve(root, "empty-module.js"),
        })),
      ],
      dedupe: [
        "react",
        "react-dom",
        "lucide-react",
        "@tanstack/react-query",
        "@assistant-ui/react",
        "viem",
        "wagmi",
        "zustand",
      ],
    },
    optimizeDeps: {
      // Workflow source stays on the server, including during dev prebundling.
      exclude: ["@aomi-labs/smither", "smithers-orchestrator"],
    },
    ssr: {
      external: ["@aomi-labs/smither", "smithers-orchestrator"],
      noExternal: [/^@aomi-labs\/(?!smither)/, "lucide-react", "tailwindcss"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["agent.minuet-salary.ts.net", "localhost", "127.0.0.1"],
      fs: { allow: [workspace] },
    },
  };
});
