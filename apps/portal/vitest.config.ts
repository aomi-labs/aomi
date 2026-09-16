import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(currentDir, "src");
const registryDir = resolve(currentDir, "../shadcn-registry/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@portal": srcDir,
      "@/components": resolve(registryDir, "components"),
      "@/hooks": resolve(registryDir, "hooks"),
      "@/lib": resolve(registryDir, "lib"),
      "@aomi-labs/widget-lib/providers/para": resolve(
        registryDir,
        "lib/wallet-kit/providers/para/index.ts",
      ),
      "@aomi-labs/widget-lib/providers/privy": resolve(
        registryDir,
        "lib/wallet-kit/providers/privy/index.ts",
      ),
      "@aomi-labs/widget-lib": registryDir,
      "@aomi-labs/account/better-auth/client": resolve(
        currentDir,
        "../../packages/account/src/better-auth/auth-client.ts",
      ),
      "@aomi-labs/account": resolve(currentDir, "../../packages/account/src"),
      "@aomi-labs/client": resolve(currentDir, "../../packages/client/src"),
      "@aomi-labs/deploy": resolve(currentDir, "../../packages/deploy/src"),
      "@aomi-labs/react": resolve(currentDir, "../../packages/react/src"),
      "@aomi-labs/service": resolve(currentDir, "../../packages/service/src"),
      "server-only": resolve(currentDir, "__mocks__/server-only.ts"),
      "client-only": resolve(currentDir, "__mocks__/client-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(currentDir, "../../vitest.setup.ts")],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        inline: ["server-only", "client-only"],
      },
    },
    // launch feature tests run as part of the suite.
    restoreMocks: true,
  },
});
