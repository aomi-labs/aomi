import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { mockStartRouteTree } from "./packages/app-kit/src/vitest";

const currentDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    mockStartRouteTree,
    react(),
    {
      name: "workspace-source-alias",
      enforce: "pre",
      resolveId(source, importer) {
        if (!source.startsWith("@/") || !importer) return;
        for (const directory of [
          "apps/portal",
          "apps/build",
          "apps/telegram",
          "apps/landing",
          "packages/widget",
        ]) {
          if (importer.startsWith(resolve(currentDir, directory) + "/")) {
            return this.resolve(
              directory === "apps/landing" && source.startsWith("@/content/")
                ? resolve(currentDir, directory, source.slice(2))
                : resolve(currentDir, directory, "src", source.slice(2)),
              importer,
              { skipSelf: true },
            );
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@build": resolve(currentDir, "apps/build/src"),
      "@portal": resolve(currentDir, "apps/portal/src"),
      "@aomi-labs/account/better-auth/client": resolve(
        currentDir,
        "packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/account": resolve(currentDir, "packages/account/src"),
      "@aomi-labs/client/browser-auth": resolve(
        currentDir,
        "packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/widget/browser-auth": resolve(
        currentDir,
        "packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/client": resolve(currentDir, "packages/client/src"),
      "@aomi-labs/deploy": resolve(currentDir, "packages/deploy/src"),
      "@aomi-labs/react": resolve(currentDir, "packages/react/src"),
      "@aomi-labs/smither": resolve(currentDir, "packages/smither/src"),
      "server-only": resolve(
        currentDir,
        "apps/portal/__mocks__/server-only.ts",
      ),
      "@tanstack/react-start/server-only": resolve(
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
    setupFiles: ["./vitest.setup.ts", "./apps/build/vitest.setup.ts"],
    include: [
      "scripts/**/*.{test,spec}.{ts,tsx,mjs,cjs,js}",
      "packages/**/*.{test,spec}.{ts,tsx,mjs,cjs,js,jsx}",
      "apps/build/src/**/*.{test,spec}.{ts,tsx}",
      "apps/telegram/src/**/*.{test,spec}.{ts,tsx}",
      "apps/telegram/test/**/*.{test,spec}.{ts,tsx}",
      "apps/landing/src/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/agent-api-proxy.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/oauth/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/features/oauth/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/lib/widget-auth/**/*.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/widget-auth/*-route.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/bff/{sentry-smoke,delegation-callback}.{test,spec}.{ts,tsx}",
      "apps/portal/src/server/device-auth/routes.{test,spec}.{ts,tsx}",
    ],
    exclude: [
      ".claude/**",
      "**/.claude/**",
      "**/node_modules/**",
      "dist/**",
      "packages/widget/**",
    ],
    restoreMocks: true,
  },
});
