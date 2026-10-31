import { defineConfig, mergeConfig } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { appConfig, loadAppEnv, sentryOptions } from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadAppEnv(root, mode);
  const base = appConfig({ root, env, walletShims: true });
  return mergeConfig(base, {
    plugins: [sentryTanstackStart(sentryOptions(env, "portal"))],
    resolve: {
      dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"],
    },
    ssr: { noExternal: [/^@aomi-labs\//] },
  });
});
