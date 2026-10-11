import { defineConfig } from "vitest/config";
import workspace from "../../vitest.config";
export default defineConfig({
  ...workspace,
  test: {
    ...workspace.test,
    root: "../..",
    include: ["apps/landing/src/**/*.{test,spec}.{ts,tsx}"],
  },
});
