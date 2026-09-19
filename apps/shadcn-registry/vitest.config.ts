import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const workspaceDir = resolve(appDir, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(appDir, "src"),
      "@aomi-labs/client": resolve(workspaceDir, "packages/client/src"),
      "@aomi-labs/react": resolve(workspaceDir, "packages/react/src"),
      "@getpara/react-sdk/styles.css": resolve(appDir, "test/empty-style.ts"),
    },
  },
  test: {
    css: false,
    environment: "jsdom",
    setupFiles: [resolve(workspaceDir, "vitest.setup.ts")],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
  },
});
