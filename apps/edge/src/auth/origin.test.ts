// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EdgeEnv } from "../env";
import { authOrigin } from "./origin";

const deadline = Date.parse("2026-12-01T00:00:00Z");
function migration(): EdgeEnv {
  return {
    BETTER_AUTH_URL: "https://aomi.chat",
    PORTAL_HOSTS: "aomi.chat,chat.aomi.dev",
    PORTAL_LEGACY_AUTH: JSON.stringify({
      origin: "https://chat.aomi.dev",
      expiresAt: "2026-12-01T00:00:00Z",
    }),
  };
}

describe("canonical and temporary legacy auth origins", () => {
  it("keeps the new primary on aomi.chat and scopes compatibility to the old host", () => {
    const env = migration();
    expect(authOrigin(env, "aomi.chat", deadline - 1)).toBe(
      "https://aomi.chat",
    );
    expect(authOrigin(env, "chat.aomi.dev", deadline - 1)).toBe(
      "https://chat.aomi.dev",
    );
    expect(authOrigin(env, "foreign.example", deadline - 1)).toBe(
      "https://aomi.chat",
    );
    expect(authOrigin(env, "", deadline - 1)).toBe("https://aomi.chat");
  });

  it("expires the legacy authority even after its policy was cached", () => {
    const env = migration();
    expect(authOrigin(env, "chat.aomi.dev", deadline - 1)).toBe(
      "https://chat.aomi.dev",
    );
    expect(authOrigin(env, "chat.aomi.dev", deadline)).toBe(
      "https://aomi.chat",
    );
    expect(authOrigin(env, "chat.aomi.dev", deadline + 1)).toBe(
      "https://aomi.chat",
    );
  });

  it("does not silently enable a legacy authority for an admitted alias", () => {
    const env = migration();
    delete env.PORTAL_LEGACY_AUTH;
    expect(authOrigin(env, "chat.aomi.dev", deadline - 1)).toBe(
      "https://aomi.chat",
    );
  });

  it.each([
    "not JSON",
    { origin: "http://chat.aomi.dev", expiresAt: "2026-12-01T00:00:00Z" },
    { origin: "https://foreign.example", expiresAt: "2026-12-01T00:00:00Z" },
    { origin: "https://aomi.chat", expiresAt: "2026-12-01T00:00:00Z" },
    {
      origin: "https://chat.aomi.dev/api/auth",
      expiresAt: "2026-12-01T00:00:00Z",
    },
    { origin: "https://chat.aomi.dev" },
    { origin: "https://chat.aomi.dev", expiresAt: "forever" },
    {
      origin: "https://chat.aomi.dev",
      expiresAt: "2026-12-01T00:00:00Z",
      wildcard: true,
    },
  ])("fails closed for invalid migration policy %j", (policy) => {
    const env = migration();
    env.PORTAL_LEGACY_AUTH =
      typeof policy === "string" ? policy : JSON.stringify(policy);
    expect(() => authOrigin(env, "aomi.chat", deadline - 1)).toThrow(
      "auth_unconfigured",
    );
  });
});
