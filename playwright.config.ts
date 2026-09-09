import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["html", { open: "never", outputFolder: "output/playwright/report" }],
    ["list"],
  ],
  projects: [
    { name: "preview", testMatch: /preview-smoke\.spec\.ts/ },
    {
      name: "local-agent",
      testMatch:
        /(?:local-(?:agent-cutover|auth-session|guest-hello)|lean-payment-boundary)\.spec\.ts/,
      fullyParallel: false,
      use: {
        baseURL: process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000",
      },
    },
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
