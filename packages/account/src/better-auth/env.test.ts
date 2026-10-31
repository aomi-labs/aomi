// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readAccountAuthEnv } from "./env";

const DEV_BETTER_AUTH_SECRET =
  "dev-better-auth-secret-change-me-at-least-32-bytes";

describe("readAccountAuthEnv", () => {
  it("keeps the local/test secret default", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      NODE_ENV: "test",
    });

    expect(env.betterAuthSecret).toBe(DEV_BETTER_AUTH_SECRET);
  });

  it.each([
    ["requires BetterAuth secret", undefined],
    ["rejects the known dev secret", DEV_BETTER_AUTH_SECRET],
  ])("%s outside development and test", (_name, BETTER_AUTH_SECRET) => {
    expect(() =>
      readAccountAuthEnv({
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: "https://app.aomi.dev",
        NODE_ENV: "production",
      }),
    ).toThrow(
      "BETTER_AUTH_SECRET must be configured outside NODE_ENV=development/test",
    );
  });

  it("trusts the configured origins and the auth URL, nothing inferred", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_SECRET: "prod-secret",
      BETTER_AUTH_URL: "https://chat.aomi.dev",
      AOMI_TRUSTED_ORIGINS: "https://build.aomi.dev",
      NODE_ENV: "production",
    });

    expect(env.betterAuthUrl).toBe("https://chat.aomi.dev");
    expect(env.siweDomain).toBe("chat.aomi.dev");
    expect(env.clientIpHeader).toBe("cf-connecting-ip");
    expect(env.trustedOrigins).toEqual([
      "https://build.aomi.dev",
      "https://chat.aomi.dev",
    ]);
  });

  it("reads the Para JWT audience from PARA_JWT_AUDIENCE alone", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      NODE_ENV: "test",
      PARA_JWT_AUDIENCE: "para-audience-uuid",
      NEXT_PUBLIC_PARA_API_KEY: "beta_public_api_key",
    });

    expect(env.paraAudience).toBe("para-audience-uuid");
    expect(
      readAccountAuthEnv({
        BETTER_AUTH_URL: "http://localhost:3001",
        NODE_ENV: "test",
        NEXT_PUBLIC_PARA_API_KEY: "beta_public_api_key",
      }).paraAudience,
    ).toBeUndefined();
  });

  it("treats blank provider env values as unset", () => {
    // A var added with an empty value (easy in the Vercel dashboard/CLI) must
    // read as unset, not as a configured empty string.
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      NODE_ENV: "test",
      PARA_JWT_AUDIENCE: "  ",
      PARA_JWKS_URL: "",
      PRIVY_IDENTITY_JWT_VERIFICATION_KEY: "",
      PRIVY_JWT_VERIFICATION_KEY: "privy-verification-key",
    });

    expect(env.paraAudience).toBeUndefined();
    expect(env.paraJwksUrl).toBeUndefined();
    expect(env.privyIdentityTokenVerificationKey).toBeUndefined();
    expect(env.privyAccessTokenVerificationKey).toBe("privy-verification-key");
  });
});
