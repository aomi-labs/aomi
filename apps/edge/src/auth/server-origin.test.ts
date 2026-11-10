// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { authServer } from "./server";
const create = vi.hoisted(() =>
  vi.fn((_env: Record<string, string | undefined>) => ({})),
);
vi.mock("@aomi-labs/account/better-auth", () => ({ createAuth: create }));

describe("auth server migration cache", () => {
  it("never reuses an expired legacy authority for a later request", () => {
    const until = Date.parse("2026-12-01T00:00:00Z");
    const env = {
      HYPERDRIVE: { connectionString: "fixture-only" },
      BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
      BETTER_AUTH_URL: "https://aomi.chat",
      PORTAL_HOSTS: "aomi.chat,chat.aomi.dev",
      PORTAL_LEGACY_AUTH: JSON.stringify({
        origin: "https://chat.aomi.dev",
        expiresAt: "2026-12-01T00:00:00Z",
      }),
    };
    const canonical = authServer(env, "aomi.chat", until - 1);
    const legacy = authServer(env, "chat.aomi.dev", until - 1);
    expect(authServer(env, "chat.aomi.dev", until - 1)).toBe(legacy);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].BETTER_AUTH_URL).toBe("https://aomi.chat");
    expect(create.mock.calls[1][0].BETTER_AUTH_URL).toBe(
      "https://chat.aomi.dev",
    );
    const retired = authServer(env, "chat.aomi.dev", until);
    expect(retired).not.toBe(legacy);
    expect(authServer(env, "aomi.chat", until)).toBe(canonical);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0]).toMatchObject({
      BETTER_AUTH_URL: "https://aomi.chat",
      AOMI_AUTH_DOMAIN: "chat.aomi.dev",
    });
  });
});
