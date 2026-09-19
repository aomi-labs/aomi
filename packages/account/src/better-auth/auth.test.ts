import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("Better Auth protocol topology", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("registers the production OAuth plugins in tests", async () => {
    const { auth } = await import("./auth");
    const pluginIds = auth.options.plugins?.map((plugin) => plugin.id);

    expect(pluginIds).toEqual(
      expect.arrayContaining([
        "oauth-provider",
        "cimd",
        "device-authorization",
      ]),
    );
  });
});
