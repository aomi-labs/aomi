import { afterEach, describe, expect, it, vi } from "vitest";

import { launchConfig, resolveLaunchPlatform } from "./config";

describe("launchConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses community launch defaults", () => {
    const config = launchConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community"]);
    expect(config.catalogPlatforms).toEqual([]);
    expect(config.templateRepo).toBe("aomi-labs/playground-example");
    expect(config.createdRepoPrivate).toBe(false);
  });

  it("honors APP_DEPLOY env overrides and comma-separated values", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "partners, somm.finance, partners");
    vi.stubEnv("APP_DEPLOY_TEMPLATE_REPO", "acme/template");
    vi.stubEnv("APP_DEPLOY_CREATED_REPO_PRIVATE", "true");

    const config = launchConfig();
    expect(config.platform).toBe("partners");
    expect(config.platforms).toEqual(["partners", "somm.finance"]);
    expect(config.catalogPlatforms).toEqual([]);
    expect(config.templateRepo).toBe("acme/template");
    expect(config.createdRepoPrivate).toBe(true);
  });

  it("accepts APP_DEPLOY_PLATFORMS as a JSON string array", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", '["somm.finance", "community", ""]');

    const config = launchConfig();
    expect(config.platform).toBe("somm.finance");
    expect(config.platforms).toEqual(["somm.finance", "community"]);
    expect(config.catalogPlatforms).toEqual([]);
  });

  it("ignores legacy singular and public platform env aliases", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORM", "partners");
    vi.stubEnv("NEXT_PUBLIC_APP_DEPLOY_PLATFORMS", "partners");
    vi.stubEnv("NEXT_PUBLIC_APP_DEPLOY_PLATFORM", "somm.finance");

    const config = launchConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community"]);
    expect(config.catalogPlatforms).toEqual([]);
  });

  it("uses explicit catalog platforms without changing deploy platforms", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community,somm.finance");
    vi.stubEnv("APP_CATALOG_PLATFORMS", "official, somm.finance, official");

    const config = launchConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community", "somm.finance"]);
    expect(config.catalogPlatforms).toEqual(["official", "somm.finance"]);
  });

  it("falls back to public catalog platform envs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_CATALOG_PLATFORMS", '["somm.finance"]');

    const config = launchConfig();
    expect(config.platform).toBe("community");
    expect(config.platforms).toEqual(["community"]);
    expect(config.catalogPlatforms).toEqual(["somm.finance"]);
  });

  it("accepts an exact platform name without a configured partner list", () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community");

    expect(resolveLaunchPlatform(" somm.finance ")).toBe("somm.finance");
    expect(resolveLaunchPlatform("partner-tag")).toBe("partner-tag");
  });

  it("rejects malformed platform names before the backend lookup", () => {
    expect(resolveLaunchPlatform("")).toBeNull();
    expect(resolveLaunchPlatform("Partner Name")).toBeNull();
    expect(resolveLaunchPlatform("../partner")).toBeNull();
  });
});
