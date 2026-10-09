import { defineConfig } from "@playwright/test";

const origin = new URL(
  process.env.AOMI_SAFETY_PORTAL_URL ?? "http://localhost:3004",
);
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("Safety regression tests require a local sandbox Portal");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "transaction-safety-local.spec.ts",
  outputDir: "output/playwright/safety",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["json", { outputFile: "output/playwright/safety/results.json" }],
  ],
  use: {
    baseURL: origin.origin,
    viewport: { width: 1440, height: 1000 },
    screenshot: "on",
    trace: "off",
  },
});
