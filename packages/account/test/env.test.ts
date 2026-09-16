// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readAccountAuthEnv } from "../src/better-auth/env";

const DEV_BETTER_AUTH_SECRET =
  "dev-better-auth-secret-change-me-at-least-32-bytes";
const TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/aomi";

describe("readAccountAuthEnv", () => {
  it("keeps the local/test secret default but never defaults the database", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
    });

    expect(env.betterAuthSecret).toBe(DEV_BETTER_AUTH_SECRET);
    expect(env.databaseUrl).toBe(TEST_DATABASE_URL);
  });

  it("requires BetterAuth secret outside development and test", () => {
    expect(() =>
      readAccountAuthEnv({
        BETTER_AUTH_URL: "https://app.aomi.dev",
        DATABASE_URL: "postgresql://prod.example/aomi",
        NODE_ENV: "production",
      }),
    ).toThrow(
      "BETTER_AUTH_SECRET must be configured outside NODE_ENV=development/test",
    );
  });

  it("requires an explicit database URL in every environment", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      expect(() =>
        readAccountAuthEnv({
          BETTER_AUTH_SECRET: "prod-secret",
          BETTER_AUTH_URL: "https://app.aomi.dev",
          NODE_ENV,
        }),
      ).toThrow("DATABASE_URL is not set");
    }
  });

  it("rejects the known dev secret outside development and test", () => {
    expect(() =>
      readAccountAuthEnv({
        BETTER_AUTH_SECRET: DEV_BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: "https://app.aomi.dev",
        DATABASE_URL: "postgresql://prod.example/aomi",
        NODE_ENV: "production",
      }),
    ).toThrow(
      "BETTER_AUTH_SECRET must be configured outside NODE_ENV=development/test",
    );
  });

  it("derives preview auth URLs from arbitrary Vercel branch URLs when no explicit override is set", () => {
    // Ephemeral PR previews get a unique *.vercel.app URL and no BETTER_AUTH_URL,
    // so auth derives from the branch URL (and AOMI_AUTH_DOMAIN is ignored on
    // preview in favour of that derived host).
    const env = readAccountAuthEnv({
      BETTER_AUTH_SECRET: "preview-secret",
      DATABASE_URL: "postgresql://preview.example/aomi",
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL:
        "chat-portal-git-codex-merge-bff-betterauth-aomi-labs.vercel.app",
      VERCEL_URL: "chat-portal-random-deployment-id-aomi-labs.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "chat.aomi.dev",
      AOMI_AUTH_DOMAIN: "chat-staging.aomi.dev",
      AOMI_TRUSTED_ORIGINS:
        "https://chat-staging.aomi.dev, https://extra-preview.aomi.dev",
    });

    expect(env.betterAuthUrl).toBe(
      "https://chat-portal-git-codex-merge-bff-betterauth-aomi-labs.vercel.app",
    );
    expect(env.siweDomain).toBe(
      "chat-portal-git-codex-merge-bff-betterauth-aomi-labs.vercel.app",
    );
    expect(env.trustedOrigins).toEqual([
      "https://chat-staging.aomi.dev",
      "https://extra-preview.aomi.dev",
      "https://chat-portal-git-codex-merge-bff-betterauth-aomi-labs.vercel.app",
      "https://chat-portal-random-deployment-id-aomi-labs.vercel.app",
      "https://chat.aomi.dev",
    ]);
  });

  it("lets an explicit BETTER_AUTH_URL win on preview (stable custom-alias deploys)", () => {
    // chat-staging.aomi.dev is a stable alias over a `preview` build; the browser
    // is served on the alias, not the *.vercel.app URL, so auth must key off the
    // explicit host or SIWE domain/origin checks reject every login.
    const env = readAccountAuthEnv({
      BETTER_AUTH_SECRET: "preview-secret",
      BETTER_AUTH_URL: "https://chat-staging.aomi.dev",
      DATABASE_URL: "postgresql://preview.example/aomi",
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "chat-portal-git-main-aomi-labs.vercel.app",
      VERCEL_URL: "chat-portal-random-deployment-id-aomi-labs.vercel.app",
    });

    expect(env.betterAuthUrl).toBe("https://chat-staging.aomi.dev");
    expect(env.siweDomain).toBe("chat-staging.aomi.dev");
    // still trusts the auto-detected preview URLs so the deploy's own hostname works
    expect(env.trustedOrigins).toEqual([
      "https://chat-staging.aomi.dev",
      "https://chat-portal-git-main-aomi-labs.vercel.app",
      "https://chat-portal-random-deployment-id-aomi-labs.vercel.app",
    ]);
  });

  it("keeps explicit production auth URL while trusting Vercel aliases", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_SECRET: "prod-secret",
      BETTER_AUTH_URL: "https://chat.aomi.dev",
      DATABASE_URL: "postgresql://prod.example/aomi",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      VERCEL_URL: "chat-portal-prod-deployment-aomi-labs.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "chat.aomi.dev",
    });

    expect(env.betterAuthUrl).toBe("https://chat.aomi.dev");
    expect(env.siweDomain).toBe("chat.aomi.dev");
    expect(env.trustedOrigins).toEqual([
      "https://chat.aomi.dev",
      "https://chat-portal-prod-deployment-aomi-labs.vercel.app",
    ]);
  });

  it("prefers the explicit Para JWT audience over the public API key", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
      PARA_JWT_AUDIENCE: "para-audience-uuid",
      NEXT_PUBLIC_PARA_API_KEY: "beta_public_api_key",
    });

    expect(env.paraAudience).toBe("para-audience-uuid");
  });

  it("treats blank provider env values as unset", () => {
    // A var added with an empty value (easy in the Vercel dashboard/CLI) must
    // fall through to the next audience source, not poison the chain: "" is
    // not nullish, so without normalization paraAudience would be "" and the
    // Para verifier would report itself unconfigured despite PARA_JWKS_URL
    // being set.
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
      PARA_JWT_AUDIENCE: "",
      PARA_AUDIENCE: "  ",
      NEXT_PUBLIC_PARA_API_KEY: "beta_public_api_key",
      PARA_JWKS_URL: "",
      PRIVY_IDENTITY_JWT_VERIFICATION_KEY: "",
      PRIVY_JWT_VERIFICATION_KEY: "privy-verification-key",
    });

    expect(env.paraAudience).toBe("beta_public_api_key");
    expect(env.paraJwksUrl).toBeUndefined();
    expect(env.privyIdentityTokenVerificationKey).toBe(
      "privy-verification-key",
    );
  });
});
