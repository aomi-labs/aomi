// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  withSentryConfig: (config: unknown) => config,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("legacy deployment redirects", () => {
  it.each([
    [undefined, "https://build.aomi.dev"],
    ["https://build-staging.aomi.dev/", "https://build-staging.aomi.dev"],
    ["http://localhost:3001", "http://localhost:3001"],
  ])("uses Build origin %s", async (configured, origin) => {
    vi.stubEnv("AOMI_BUILD_URL", configured);
    const { default: config } = await import("../../next.config");
    expect(await config.redirects!()).toEqual([
      {
        source: "/deployments/new",
        destination: `${origin}/operate/deployments/new`,
        permanent: false,
      },
      {
        source: "/deployments/:projectId",
        destination: `${origin}/projects/:projectId`,
        permanent: false,
      },
      {
        source: "/deployments",
        destination: `${origin}/projects`,
        permanent: false,
      },
    ]);
  });
});
