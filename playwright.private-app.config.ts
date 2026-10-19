import { defineConfig } from "@playwright/test";
import journeys from "./playwright.journeys.config";
import type { JourneyOptions } from "./tests/e2e/journey-fixture";

// Opt-in local verification against a disposable real Rust key resolver.
// Kept separate from the ordinary controlled-Agent CI journeys.
const servers = Array.isArray(journeys.webServer) ? journeys.webServer : [];
const portal = "http://127.0.0.1:3463";
const localOrigin = (value: string) =>
  value.replaceAll("http://127.0.0.1:3460", portal);
export default defineConfig<JourneyOptions>({
  ...journeys,
  use: { ...journeys.use, portal },
  testMatch: /private-app-library\.local\.spec\.ts$/,
  projects: journeys.projects
    ?.filter((project) => ["portal", "mobile"].includes(project.name!))
    .map((project) => ({
      ...project,
      use: { ...project.use, baseURL: portal },
    })),
  webServer: servers.slice(0, 2).map((server) => ({
    ...server,
    command: server.command?.replaceAll("3460", "3463"),
    url: server.url ? localOrigin(server.url) : undefined,
    stdout: "pipe",
    env: {
      ...server.env,
      ...Object.fromEntries(
        Object.entries(server.env ?? {}).map(([name, value]) => [
          name,
          localOrigin(value!),
        ]),
      ),
      AOMI_HIDE_DEV_INDICATOR: "true",
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
    timeout: 900_000,
  })),
  retries: 0,
});
