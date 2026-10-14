import { defineConfig } from "@playwright/test";

// Suites that keep real auth, signing and deployments. The journeys on the
// fake agent backend have their own config: playwright.journeys.config.ts.
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright/test-results",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["html", { open: "never", outputFolder: "output/playwright/report" }],
    ["list"],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "preview", testMatch: /preview-smoke\.spec\.ts/ },
    {
      name: "hosted-wallet",
      testMatch: /hosted-wallet-journeys\.spec\.ts/,
      retries: 0,
      workers: 1,
      use: { trace: "off", screenshot: "off", video: "off" },
    },
    {
      // Started by scripts/test-browser-contracts.mjs.
      name: "browser-contracts",
      testMatch:
        /(?:portal-auth-contracts|visual-signing-contracts|widget-browser-contracts)\.spec\.ts/,
      retries: 0,
      workers: 1,
      use: { colorScheme: "light" },
    },
  ],
});
