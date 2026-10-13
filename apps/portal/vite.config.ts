import { defineConfig, mergeConfig, type Plugin } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import {
  appConfig,
  loadAppEnv,
  serverOnlySpecifiers,
} from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import widgetEntries from "../../packages/widget/package-entries.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));
const portalSource = resolve(root, "src");
const widgetRoot = resolve(root, "../../packages/widget");
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
  const env = loadAppEnv(root, mode);
  const sha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  const sentryEnabled =
    env.SENTRY_ENABLED === "1" &&
    ["staging", "production"].includes(env.SENTRY_ENVIRONMENT || "") &&
    env.SENTRY_PROJECT === "aomi-bff" &&
    Boolean(env.SENTRY_ORG && env.SENTRY_AUTH_TOKEN && sha);
  const base = appConfig({
    root,
    env,
    publicEnv: {
      NEXT_PUBLIC_BACKEND_URL: env.BACKEND_URL || "http://127.0.0.1:8080",
      NEXT_PUBLIC_ANVIL_URL: env.ANVIL_URL || "http://127.0.0.1:8545",
      NEXT_PUBLIC_VERCEL_ENV: env.VERCEL_ENV || "",
    },
    // Portal scopes @/ itself so widget source keeps its own.
    plugins: [scopedSourceImports],
    sourceAlias: false,
    walletShims: true,
    importProtection: {
      include: [
        "**/apps/portal/src/**",
        "**/packages/account/src/**",
        "**/packages/observability/src/**",
      ],
      specifiers: [...serverOnlySpecifiers, /^@aomi-labs\/observability/],
    },
    nitro: {
      vercel: {
        functionRules: {
          "/v1/agent": { maxDuration: 300 },
          "/v1/agent/**": { maxDuration: 300 },
          "/v1/pipeline": { maxDuration: 300 },
          "/v1/pipeline/**": { maxDuration: 300 },
        },
      },
    },
  });
  return mergeConfig(base, {
    plugins: [
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
    resolve: {
      // Let Vite split declared UI entries before package prebundling combines
      // overlays with the wallet runtime. Consumers still use packed outputs.
      alias: Object.entries(widgetEntries.entries).map(([entry, source]) => ({
        find: new RegExp(
          `^@aomi-labs/widget${entry === "index" ? "" : `/${entry}`}$`,
        ),
        replacement: resolve(widgetRoot, source),
      })),
      dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"],
    },
    ssr: {
      // Resolve auth's Zod 4 in its own graph before Nitro packages the app,
      // whose wallet dependencies still use Zod 3.
      noExternal: [/^@aomi-labs\//, "better-auth", /^@better-auth\//, "zod"],
    },
    build: { sourcemap: sentryEnabled },
  });
});
