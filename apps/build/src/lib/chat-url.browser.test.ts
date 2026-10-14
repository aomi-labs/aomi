// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultChatUrl } from "./chat-url";

afterEach(() => vi.unstubAllEnvs());

describe("Build browser chat environment", () => {
  it("uses only the explicit public deployment environment", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(defaultChatUrl()).toBe("https://chat-staging.aomi.dev");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    expect(defaultChatUrl()).toBe("https://chat.aomi.dev");
  });
});
