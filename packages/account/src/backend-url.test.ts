import { describe, expect, it } from "vitest";
import { backendUrlFromEnv } from "./backend-url";
describe("signer and forwarder backend precedence", () => {
  it("uses the explicit proxy target before legacy values", () => {
    expect(
      backendUrlFromEnv({
        AOMI_PROXY_BACKEND_URL: "https://api-staging.aomi.dev/",
        BACKEND_URL: "https://api.aomi.dev",
        NEXT_PUBLIC_BACKEND_URL: "/",
      }),
    ).toBe("https://api-staging.aomi.dev");
  });
  it("ignores browser-relative URLs and uses deployment defaults", () => {
    expect(
      backendUrlFromEnv({
        BACKEND_URL: "/",
        NEXT_PUBLIC_BACKEND_URL: "/",
        VERCEL_ENV: "production",
      }),
    ).toBe("https://api.aomi.dev");
  });
});
