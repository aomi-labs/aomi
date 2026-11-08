// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseUrlOf } from "./context";
import type { CliState } from "./state";
afterEach(() => vi.unstubAllEnvs());
describe("headless host", () => {
  it("defaults to API while retaining explicitly saved client endpoints", () => {
    vi.stubEnv("AOMI_BACKEND_URL", "");
    delete process.env.AOMI_BACKEND_URL;
    expect(baseUrlOf({}, {} as CliState)).toBe("https://api.aomi.dev");
    expect(
      baseUrlOf({}, { baseUrl: "https://chat.aomi.dev" } as CliState),
    ).toBe("https://chat.aomi.dev");
    expect(
      baseUrlOf({ backendUrl: "https://custom.example/" }, {} as CliState),
    ).toBe("https://custom.example");
  });
});
