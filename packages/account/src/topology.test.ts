import { chdir, cwd } from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("account topology", () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    originalCwd = cwd();
    tempDir = mkdtempSync(join(tmpdir(), "aomi-account-topology-"));
  });

  afterEach(() => {
    chdir(originalCwd);
    process.env = { ...ORIGINAL_ENV };
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("selects staging and production topology by exact backend host", async () => {
    const { portalTopologyName } = await import("./topology");

    process.env.AOMI_PROXY_BACKEND_URL = "https://api-staging.aomi.dev";
    expect(portalTopologyName()).toBe("staging");

    process.env.AOMI_PROXY_BACKEND_URL = "https://api.aomi.dev";
    expect(portalTopologyName()).toBe("production");
  });

  it("authorizes aomi-bff for the sidecar audience in every topology", async () => {
    // The aomi-build live-files sidecar verifies bearers minted by aomi-bff
    // with audience "aomi-sidecar" (never "aomi-backend", so a bearer leaked
    // from the sandbox is useless at the backend).
    const { PORTAL_TOPOLOGIES } = await import("./topology-data");
    const { parseTopology } = await import("./service-topology");
    for (const toml of Object.values(PORTAL_TOPOLOGIES)) {
      const bff = parseTopology(toml).services.find(
        (node) => node.name === "aomi-bff",
      );
      expect(bff?.audiences).toContain("aomi-sidecar");
    }
  });

  it("constructs the service without app-root topology files", async () => {
    chdir(tempDir);
    const testGlobal = globalThis as typeof globalThis & {
      __AOMI_ALLOW_BROWSER__?: boolean;
    };
    testGlobal.__AOMI_ALLOW_BROWSER__ = true;
    try {
      const { portalService } = await import("./topology");

      expect(() => portalService()).not.toThrow();
    } finally {
      delete testGlobal.__AOMI_ALLOW_BROWSER__;
    }
  });
});
