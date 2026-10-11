import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeBrowserCases, nativeBrowserTransport } from "./requirements.mjs";

const app = process.env.NATIVE_BROWSER_APP;
const origin = process.env.NATIVE_BROWSER_ORIGIN;
if (!nativeBrowserCases[app] || !origin)
  throw new Error(
    "Run scripts/test-native-browser.mjs with a copied native artifact",
  );
const transport = nativeBrowserTransport(app, origin);
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, "output/ci/native-browser", app);

export default defineConfig({
  testDir: fileURLToPath(new URL("./", import.meta.url)),
  testMatch: `${app}.spec.mjs`,
  outputDir: join(output, "results"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: join(output, "report.json") }]],
  projects: [{ name: app }],
  use: {
    browserName: "chromium",
    // Only this separate Telegram context accepts its ephemeral self-signed cert.
    ...transport,
    viewport:
      app === "landing"
        ? { width: 1440, height: 1000 }
        : { width: 400, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The real app's localhost preview intentionally permits an unverified launch.
    launchOptions: {
      args: [
        "--no-proxy-server",
        // This hostname resolves locally without enabling the app's localhost preview.
        "--host-resolver-rules=MAP telegram-artifact.localhost 127.0.0.1, EXCLUDE localhost",
      ],
    },
  },
});
