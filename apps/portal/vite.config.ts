import { defineConfig, mergeConfig } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { appConfig, loadAppEnv } from "@aomi-labs/app-kit/vite";
import { commitSha } from "@aomi-labs/app-kit/platform";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadAppEnv(root, mode);
  const sha = commitSha(env);
  const release = sha ? `portal-bff@${sha}` : undefined;
  const sentryEnabled =
    env.SENTRY_ENABLED === "1" &&
    ["staging", "production"].includes(env.SENTRY_ENVIRONMENT || "") &&
    env.SENTRY_PROJECT === "aomi-bff" &&
    Boolean(env.SENTRY_ORG && env.SENTRY_AUTH_TOKEN && release);
  const base = appConfig({ root, env, walletShims: true });
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
      dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"],
    },
    ssr: { noExternal: [/^@aomi-labs\//] },
  });
});
