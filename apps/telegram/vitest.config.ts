import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const registryDir = resolve(currentDir, "../shadcn-registry/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(currentDir, "src"),
      // Only the Privy-free UI primitives and tokens are consumed from
      // widget-lib; its provider entrypoints are deliberately not aliased, so a
      // test that imported one would fail rather than quietly pull Privy v2 in.
      "@aomi-labs/widget-lib": registryDir,
      "@aomi-labs/account": resolve(currentDir, "../../packages/account/src"),
      "@aomi-labs/client": resolve(currentDir, "../../packages/client/src"),
      "@aomi-labs/react": resolve(currentDir, "../../packages/react/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "test/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", ".next/**"],
    restoreMocks: true,
  },
});
