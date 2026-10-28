import { describe, expect, it } from "vitest";

import { createAuth } from "./auth";

describe("Better Auth protocol topology", () => {
  it("registers the production OAuth plugins, framework-neutral", () => {
    const auth = createAuth({ NODE_ENV: "test", BETTER_AUTH_URL: "http://localhost:3001" });
    const pluginIds = auth.options.plugins?.map((plugin) => plugin.id);

    expect(pluginIds).toEqual(
      expect.arrayContaining(["oauth-provider", "cimd", "device-authorization"]),
    );
    expect(pluginIds).not.toContain("next-cookies");
  });
});
