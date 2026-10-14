import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(currentDir, "src");
const registryDir = resolve(currentDir, "../../packages/widget/src");

export default defineConfig({
  plugins: [react()],
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
    exclude: [
      "src/lib/usage-range.test.ts",
    ],
    // usage-range uses node:test (tsx --test), not vitest.
    // launch feature tests run as part of the suite.
    restoreMocks: true,
  },
});
