import { defineConfig, loadEnv, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import publicKeys from "./public-env.keys.json" with { type: "json" };
import widgetEntries from "../../packages/widget/package-entries.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = resolve(root, "../..");
const portalSource = resolve(root, "src");
const widgetRoot = resolve(workspace, "packages/widget");
const widgetSource = resolve(widgetRoot, "src");
const scopedSourceImports: Plugin = {
  name: "aomi-scoped-source-imports",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!source.startsWith("@/")) return null;
    // Widget source keeps its own @/ imports and context instances.
    const owner = importer?.startsWith(`${widgetSource}/`)
      ? widgetSource
      : portalSource;
    return this.resolve(resolve(owner, source.slice(2)), importer, {
      skipSelf: true,
    });
  },
};
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && process.env[key] === undefined)
      process.env[key] = value;
  }
  const publicEnv: Record<string, string | undefined> = Object.fromEntries(
    publicKeys.map((key) => [key, env[key] || undefined]),
  );
  publicEnv.NEXT_PUBLIC_BACKEND_URL ||=
    env.BACKEND_URL || "http://127.0.0.1:8080";
  publicEnv.NEXT_PUBLIC_ANVIL_URL ||= env.ANVIL_URL || "http://127.0.0.1:8545";
  publicEnv.NEXT_PUBLIC_VERCEL_ENV ||= env.VERCEL_ENV || "";
  const sha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  const sentryEnabled =
    env.SENTRY_ENABLED === "1" &&
    ["staging", "production"].includes(env.SENTRY_ENVIRONMENT || "") &&
    env.SENTRY_PROJECT === "aomi-bff" &&
    Boolean(env.SENTRY_ORG && env.SENTRY_AUTH_TOKEN && sha);
  return {
    plugins: [
      scopedSourceImports,
      tanstackStart({
        importProtection: {
          behavior: "error",
          include: [
            "**/apps/portal/src/**",
            "**/packages/account/src/**",
            "**/packages/observability/src/**",
          ],
          client: {
            files: ["**/*.server.*", "**/src/server/**"],
            specifiers: [
              "server-only",
              /^@aomi-labs\/account(?:$|\/(?!better-auth\/client))/,
              /^@aomi-labs\/observability/,
            ],
          },
        },
      }),
      nitro({
        preset: env.VERCEL === "1" ? "vercel" : "node-server",
        vercel: {
          functionRules: {
            "/v1/agent": { maxDuration: 300 },
            "/v1/agent/**": { maxDuration: 300 },
            "/v1/pipeline": { maxDuration: 300 },
            "/v1/pipeline/**": { maxDuration: 300 },
          },
        },
      }),
      react(),
      sentryTanstackStart({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        release: {
          name: sha ? `portal-bff@${sha}` : undefined,
          create: sentryEnabled,
          finalize: sentryEnabled,
        },
        sourcemaps: {
          disable: !sentryEnabled,
          filesToDeleteAfterUpload: [
            "./.output/**/*.map",
            "./.vercel/output/**/*.map",
            "./dist/**/*.map",
          ],
        },
        autoInstrumentMiddleware: false,
        telemetry: false,
        silent: true,
      }),
    ],
    define: Object.fromEntries(
      Object.entries(publicEnv).map(([key, value]) => [
        `process.env.${key}`,
        value === undefined ? "undefined" : JSON.stringify(value),
      ]),
    ),
    resolve: {
      alias: [
        // Let Vite split declared UI entries before package prebundling combines
        // overlays with the wallet runtime. Consumers still use packed outputs.
        ...Object.entries(widgetEntries.entries).map(([entry, source]) => ({
          find: new RegExp(
            `^@aomi-labs/widget${entry === "index" ? "" : `/${entry}`}$`,
          ),
          replacement: resolve(widgetRoot, source),
        })),
        {
          find: "server-only",
          replacement: "@tanstack/react-start/server-only",
        },
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
    ssr: {
      // Resolve auth's Zod 4 in its own graph before Nitro packages the app,
      // whose wallet dependencies still use Zod 3.
      noExternal: [
        /^@aomi-labs\//,
        "better-auth",
        /^@better-auth\//,
        "zod",
        "lucide-react",
        "tailwindcss",
      ],
    },
    build: { sourcemap: sentryEnabled },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["localhost", "127.0.0.1", "agent.minuet-salary.ts.net"],
      fs: { allow: [workspace] },
    },
  };
});
