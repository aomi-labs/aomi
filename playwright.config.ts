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
      name: "guest-regression",
      testMatch: /guest-regression\.spec\.ts/,
      use: { baseURL: process.env.GUEST_BROWSER_BASE_URL },
    },
    {
      name: "hosted-wallet",
      testMatch: /hosted-wallet-journeys\.spec\.ts/,
      fullyParallel: false,
      retries: 0,
      workers: 1,
      use: { trace: "off", screenshot: "off", video: "off" },
    },
    {
      name: "local-agent",
      testMatch:
        /(?:local-(?:agent-cutover|auth-session|guest-hello|capabilities)|lean-payment-boundary|routing-ui-(?:manual|locked|sign-action|solana))\.spec\.ts/,
      fullyParallel: false,
      use: {
        baseURL: process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000",
      },
    },
    {
      name: "browser-contracts",
      testMatch:
        /(?:portal-auth-contracts|visual-signing-contracts|widget-browser-contracts)\.spec\.ts/,
      fullyParallel: false,
      retries: 0,
      workers: 1,
      use: { trace: "retain-on-failure", colorScheme: "light" },
    },
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
