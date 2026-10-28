import { defineConfig, mergeConfig } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { appConfig, loadAppEnv } from "@aomi-labs/app-kit/vite";
import { commitSha, deployStage } from "@aomi-labs/app-kit/platform";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
// Workflow source stays on the server, including during dev prebundling.
const serverWorkflows = ["@aomi-labs/smither", "smithers-orchestrator"];

export default defineConfig(({ mode }) => {
  const env = loadAppEnv(root, mode);
  const stage = deployStage(env);
  const backend =
    stage === "production"
      ? "https://api.aomi.dev"
      : stage === "preview"
        ? "https://api-staging.aomi.dev"
        : "http://127.0.0.1:8080";
  const gitSha = commitSha(env);
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
      NEXT_PUBLIC_CHAT_URL:
        stage === "production"
          ? "https://chat.aomi.dev"
          : "https://chat-staging.aomi.dev",
      NEXT_PUBLIC_BUILD_ENGINE: "",
    },
    walletShims: true,
    nitro: {
      traceDeps: ["@aomi-labs/smither*", "smithers-orchestrator*"],
      // Bun-flavored and Node-only: never bundled. A Workers build leaves the
      // sandbox routes to a container.
      rolldownConfig: { external: serverWorkflows },
    },
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
    resolve: {
      // @aomi-labs/observability imports the Next SDK for the portal; Build
      // runs on Node, so the same calls go to the Node SDK.
      alias: {
        "@sentry/nextjs": fileURLToPath(import.meta.resolve("@sentry/node")),
      },
      dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"],
    },
    optimizeDeps: { exclude: serverWorkflows },
    ssr: {
      external: serverWorkflows,
      noExternal: [/^@aomi-labs\/(?!smither)/],
    },
  });
});
