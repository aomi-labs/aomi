import { defineConfig, mergeConfig } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { appConfig, loadAppEnv } from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
// Workflow source stays on the server, including during dev prebundling.
const serverWorkflows = ["@aomi-labs/smither", "smithers-orchestrator"];

export default defineConfig(({ mode }) => {
  const env = loadAppEnv(root, mode);
  const backend =
    env.VERCEL_ENV === "production"
      ? "https://api.aomi.dev"
      : env.VERCEL_ENV === "preview"
        ? "https://api-staging.aomi.dev"
        : "http://127.0.0.1:8080";
  const gitSha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA;
  const release = gitSha ? `build-bff@${gitSha}` : undefined;
  const sentryEnabled =
    env.SENTRY_ENABLED === "1" &&
    ["staging", "production"].includes(env.SENTRY_ENVIRONMENT || "") &&
    env.SENTRY_PROJECT === "aomi-bff" &&
    Boolean(env.SENTRY_ORG && env.SENTRY_AUTH_TOKEN && release);
  const base = appConfig({
    root,
    env,
    publicEnv: {
      NEXT_PUBLIC_BACKEND_URL: env.BACKEND_URL || backend,
      NEXT_PUBLIC_CHAT_URL: "",
      NEXT_PUBLIC_BUILD_ENGINE: "",
      NEXT_PUBLIC_VERCEL_ENV: env.VERCEL_ENV || "",
    },
    walletShims: true,
    nitro: { traceDeps: ["@aomi-labs/smither*", "smithers-orchestrator*"] },
    host: "0.0.0.0",
  });
  return mergeConfig(base, {
    plugins: [
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
    resolve: { dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"] },
    optimizeDeps: { exclude: serverWorkflows },
    ssr: {
      external: serverWorkflows,
      noExternal: [/^@aomi-labs\/(?!smither)/],
    },
  });
});
