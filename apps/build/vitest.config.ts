import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import { mockStartRouteTree } from "../../scripts/mock-start-route-tree";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(currentDir, "src");
const registryDir = resolve(currentDir, "../../packages/widget/src");

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  plugins: [mockStartRouteTree],
  resolve: {
    alias: {
      "@": srcDir,
      "@/components": resolve(registryDir, "components"),
      "@/hooks": resolve(registryDir, "hooks"),
      "@/lib": resolve(registryDir, "lib"),
      "@aomi-labs/widget": registryDir,
      "@aomi-labs/account": resolve(currentDir, "../../packages/account/src"),
      "@aomi-labs/client": resolve(currentDir, "../../packages/client/src"),
      "@aomi-labs/deploy": resolve(currentDir, "../../packages/deploy/src"),
      "@aomi-labs/react": resolve(currentDir, "../../packages/react/src"),
      "@aomi-labs/smither": resolve(currentDir, "../../packages/smither/src"),
      "server-only": resolve(currentDir, "__mocks__/server-only.ts"),
      "@tanstack/react-start/server-only": resolve(
        currentDir,
        "__mocks__/server-only.ts",
      ),
      "client-only": resolve(currentDir, "__mocks__/client-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [
      resolve(currentDir, "../../vitest.setup.ts"),
      resolve(currentDir, "vitest.setup.ts"),
    ],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        inline: ["server-only", "client-only"],
      },
    },
    restoreMocks: true,
  },
});
