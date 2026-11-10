import { defineConfig, mergeConfig } from "vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { appConfig, loadAppEnv, sentryOptions } from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadAppEnv(root, mode);
  const base = appConfig({
    root,
    env,
    walletShims: true,
    nitro: {
      rolldownConfig: {
        preserveEntrySignatures: "allow-extension",
        output: {
          // Do not pull viem's shared helpers into a lazy wallet vendor's chunk.
          // Loading those helpers must not evaluate browser-only SDK modules.
          codeSplitting: { includeDependenciesRecursively: false },
          strictExecutionOrder: true,
        },
      },
    },
  });
  return mergeConfig(base, {
    plugins: [sentryTanstackStart(sentryOptions(env, "portal"))],
    resolve: {
      dedupe: ["@assistant-ui/react", "viem", "wagmi", "zustand"],
    },
    ssr: { noExternal: [/^@aomi-labs\//] },
  });
});
