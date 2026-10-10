import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import type { JourneyOptions } from "./tests/e2e/journey-fixture";
import { portalEnv } from "./tests/e2e/portal-env";

// With JOURNEY_PORTAL_URL set, the hosts are already running (the packed
// consumer runner builds them). Otherwise Playwright starts the fake upstream,
// a production Portal build and the Vite embed example on these ports.
const ports = { portal: 3460, embed: 3461, upstream: 3462 };
const external = process.env.JOURNEY_PORTAL_URL;
const portal = external ?? `http://127.0.0.1:${ports.portal}`;
const embed = external
  ? required("JOURNEY_EMBED_URL")
  : `http://127.0.0.1:${ports.embed}`;
const next = process.env.JOURNEY_NEXT_URL;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localHosts(): PlaywrightTestConfig["webServer"] {
  const upstream = `http://127.0.0.1:${ports.upstream}`;
  const databaseUrl = required("AOMI_TEST_DATABASE_URL");
  if (process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1")
    throw new Error(
      "AOMI_TEST_DATABASE_DISPOSABLE=1 must confirm the journeys may reset AOMI_TEST_DATABASE_URL",
    );
  const env = {
    ...portalEnv({ portal, upstream, databaseUrl, embedOrigins: [embed] }),
    AOMI_TEST_DATABASE_DISPOSABLE: "1",
  };
  return [
    {
      command: `pnpm exec tsx tests/e2e/fake-backend/serve.ts ${ports.upstream}`,
      url: `${upstream}/__records`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "pnpm exec tsx apps/portal/scripts/migrate-browser-contract-db.ts && pnpm --dir apps/portal build && pnpm --dir apps/portal start",
      url: portal,
      env: { ...env, HOST: "127.0.0.1", PORT: String(ports.portal) },
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm --dir examples/embed-vite exec vite --host 127.0.0.1 --port ${ports.embed} --strictPort`,
      url: embed,
      env: {
        VITE_AOMI_API_URL: portal,
        VITE_AOMI_APPLICATION_ID: "1",
        VITE_PARA_API_KEY: "ci-fixture-not-a-secret",
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ];
}

const desktop = { width: 1440, height: 1000 };
// Embeds take their app from props, not from the page URL.
const portalOnly = /url-app-context\.spec\.ts$/;

export default defineConfig<JourneyOptions>({
  testDir: "tests/e2e",
  testMatch: /(?:journeys|performance)\/.+\.spec\.ts$/,
  outputDir: "output/playwright/journeys",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: true,
  reporter: [
    ["list"],
    ["json", { outputFile: "output/playwright/journeys.json" }],
  ],
  webServer: external ? undefined : localHosts(),
  use: {
    portal,
    trace: "on",
    video: "on",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "portal", use: { baseURL: portal, viewport: desktop } },
    {
      name: "embed-vite",
      testIgnore: portalOnly,
      use: { baseURL: embed, viewport: desktop },
    },
    {
      name: "mobile",
      use: {
        baseURL: portal,
        viewport: { width: 400, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    ...(next
      ? [
          {
            name: "embed-next",
            testIgnore: portalOnly,
            use: { baseURL: next, viewport: desktop },
          },
        ]
      : []),
  ],
});
