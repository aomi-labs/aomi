import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(currentDir, "src");
const widgetSrcDir = resolve(currentDir, "../../packages/widget/src");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "workspace-source-alias",
      enforce: "pre",
      resolveId(source, importer) {
        if (!source.startsWith("@/") || !importer) return;
        const importingFile = resolve(currentDir, importer);
        for (const directory of [srcDir, widgetSrcDir]) {
          if (importingFile.startsWith(directory + "/")) {
            return this.resolve(resolve(directory, source.slice(2)), importer, {
              skipSelf: true,
            });
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@aomi-labs/account/better-auth/client": resolve(
        currentDir,
        "../../packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/account": resolve(currentDir, "../../packages/account/src"),
      "@aomi-labs/widget/browser-auth": resolve(
        currentDir,
        "../../packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/client/browser-auth": resolve(
        currentDir,
        "../../packages/client/src/browser-auth.ts",
      ),
      "@aomi-labs/client": resolve(currentDir, "../../packages/client/src"),
      "@aomi-labs/deploy": resolve(currentDir, "../../packages/deploy/src"),
      "@aomi-labs/react": resolve(currentDir, "../../packages/react/src"),
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
