// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { baseUrlOf } from "./context";
import type { CliState } from "./state";

describe("headless host", () => {
  it("defaults to the API and keeps explicitly saved endpoints", () => {
    vi.stubEnv("AOMI_BACKEND_URL", undefined);
    expect(baseUrlOf({}, {} as CliState)).toBe("https://api.aomi.dev");
    expect(baseUrlOf({}, { baseUrl: "https://chat.aomi.dev" } as CliState)).toBe("https://chat.aomi.dev");
    vi.unstubAllEnvs();
  });
});
