import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyDeploymentRedirect } from "./legacy-redirect";

afterEach(() => vi.unstubAllEnvs());

describe("legacy deployment redirects", () => {
  it.each([
    [undefined, "https://build.aomi.dev"],
    ["https://build-staging.aomi.dev/", "https://build-staging.aomi.dev"],
    ["http://localhost:3001", "http://localhost:3001"],
  ])("uses Build origin %s", (configured, origin) => {
    vi.stubEnv("AOMI_BUILD_URL", configured);
    const at = (path: string) =>
      legacyDeploymentRedirect(new Request(`http://portal.test${path}`))
        ?.headers.get("location");
    expect(at("/deployments/new")).toBe(`${origin}/operate/deployments/new`);
    expect(at("/deployments/p1?tab=logs")).toBe(`${origin}/projects/p1?tab=logs`);
    expect(at("/deployments")).toBe(`${origin}/projects`);
    expect(at("/deploymentsx")).toBeUndefined();
  });
});
