import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import workspace from "../../vitest.config";
export default defineConfig({
  ...workspace,
  test: {
    ...workspace.test,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    include: ["apps/landing/src/**/*.{test,spec}.{ts,tsx}"],
  },
});
