import { afterEach, describe, expect, it, vi } from "vitest";

import { deployConfig } from "@/server/env";
import { resolveDeployPlatform } from "./config";

describe("deployConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses community launch defaults", () => {
    const config = deployConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community"]);
    expect(config.templateRepo).toBe("aomi-labs/playground-example");
    expect(config.createdRepoPrivate).toBe(false);
  });

  it("honors APP_DEPLOY env overrides and comma-separated values", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "partners, somm.finance, partners");
    vi.stubEnv("APP_DEPLOY_TEMPLATE_REPO", "acme/template");
    vi.stubEnv("APP_DEPLOY_CREATED_REPO_PRIVATE", "true");

    const config = deployConfig();
    expect(config.platform).toBe("partners");
    expect(config.platforms).toEqual(["partners", "somm.finance"]);
    expect(config.templateRepo).toBe("acme/template");
    expect(config.createdRepoPrivate).toBe(true);
  });

  it("accepts APP_DEPLOY_PLATFORMS as a JSON string array", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", '["somm.finance", "community", ""]');

    const config = deployConfig();
    expect(config.platform).toBe("somm.finance");
    expect(config.platforms).toEqual(["somm.finance", "community"]);
  });

  it("ignores legacy singular and public platform env aliases", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORM", "partners");
    vi.stubEnv("NEXT_PUBLIC_APP_DEPLOY_PLATFORMS", "partners");
    vi.stubEnv("NEXT_PUBLIC_APP_DEPLOY_PLATFORM", "somm.finance");

    const config = deployConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community"]);
  });

  it("accepts an exact platform name without a configured partner list", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community");

    expect(resolveDeployPlatform(" somm.finance ")).toBe("somm.finance");
    expect(resolveDeployPlatform("partner-tag")).toBe("partner-tag");
  });

  it("rejects malformed platform names before the backend lookup", () => {
    expect(resolveDeployPlatform("")).toBeNull();
    expect(resolveDeployPlatform("Partner Name")).toBeNull();
    expect(resolveDeployPlatform("../partner")).toBeNull();
  });
});
