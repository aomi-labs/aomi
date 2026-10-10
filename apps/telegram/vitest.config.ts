import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const registryDir = resolve(currentDir, "../../packages/widget/src");

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    alias: {
      "@": resolve(currentDir, "src"),
      // Only the Privy-free UI primitives and tokens are consumed from
      // widget-lib; its provider entrypoints are deliberately not aliased, so a
      // test that imported one would fail rather than quietly pull Privy v2 in.
      "@aomi-labs/widget": registryDir,
      "@aomi-labs/account": resolve(currentDir, "../../packages/account/src"),
      "@aomi-labs/client": resolve(currentDir, "../../packages/client/src"),
      "@aomi-labs/react": resolve(currentDir, "../../packages/react/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "test/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", ".next/**"],
    restoreMocks: true,
  },
});
