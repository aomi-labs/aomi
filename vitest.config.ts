import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const currentDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@build": resolve(currentDir, "apps/build/src"),
      "@portal": resolve(currentDir, "apps/portal/src"),
      "@aomi-labs/account/better-auth/client": resolve(
        currentDir,
        "packages/account/src/better-auth/auth-client.ts",
      ),
      "@aomi-labs/account": resolve(currentDir, "packages/account/src"),
      "@aomi-labs/client": resolve(currentDir, "packages/client/src"),
      "@aomi-labs/deploy": resolve(currentDir, "packages/deploy/src"),
      "@aomi-labs/react": resolve(currentDir, "packages/react/src"),
      "@aomi-labs/service": resolve(currentDir, "packages/service/src"),
      "@aomi-labs/smither": resolve(currentDir, "packages/smither/src"),
      "server-only": resolve(
        currentDir,
        "apps/portal/__mocks__/server-only.ts",
      ),
      "client-only": resolve(
        currentDir,
        "apps/portal/__mocks__/client-only.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "packages/**/*.{test,spec}.{ts,tsx,mjs,cjs,js,jsx}",
      "apps/build/src/**/*.{test,spec}.{ts,tsx}",
      "apps/telegram/src/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/agent-api-proxy.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/oauth/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/app/oauth/consent/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/lib/widget-auth/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/app/api/**/route.{test,spec}.{ts,tsx}",
      "apps/portal/src/app/v1/{agent,pipeline}/**/route.{test,spec}.{ts,tsx}",
      "apps/portal/src/app/{agent,pipeline}/mcp/route.{test,spec}.{ts,tsx}",
    ],
    exclude: [".claude/**", "**/.claude/**", "**/node_modules/**", "dist/**"],
    restoreMocks: true,
  },
});
