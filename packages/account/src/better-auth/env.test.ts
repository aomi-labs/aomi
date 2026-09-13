import { describe, expect, it } from "vitest";
import { readAccountAuthEnv } from "./env";
import { aomiOAuthResources } from "./oauth-policy";

const previewEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  VERCEL_URL: "chat-portal-immutable-aomi-labs.vercel.app",
  VERCEL_BRANCH_URL: "chat-portal-git-feature-aomi-labs.vercel.app",
  BETTER_AUTH_SECRET: "preview-auth-secret-at-least-32-bytes",
  DATABASE_URL: "postgresql://localhost/aomi_test",
};

describe("hosted account auth origins", () => {
  it("uses the exact deployment for preview issuer, SIWE domain, and OAuth resources", () => {
    const auth = readAccountAuthEnv(previewEnv);
    expect(auth.betterAuthUrl).toBe(
      "https://chat-portal-immutable-aomi-labs.vercel.app",
    );
    expect(auth.siweDomain).toBe("chat-portal-immutable-aomi-labs.vercel.app");
    expect(auth.trustedOrigins).toContain(auth.betterAuthUrl);
    expect(auth.trustedOrigins).toContain(
      "https://chat-portal-git-feature-aomi-labs.vercel.app",
    );
    expect(aomiOAuthResources(previewEnv).agentRest).toBe(
      `${auth.betterAuthUrl}/v1/agent`,
    );
  });

  it("keeps an explicit stable staging issuer on preview-class deployments", () => {
    const auth = readAccountAuthEnv({
      ...previewEnv,
      BETTER_AUTH_URL: "https://chat-staging.aomi.dev",
    });
    expect(auth.betterAuthUrl).toBe("https://chat-staging.aomi.dev");
    expect(auth.siweDomain).toBe("chat-staging.aomi.dev");
    expect(auth.trustedOrigins).toContain(
      "https://chat-portal-immutable-aomi-labs.vercel.app",
    );
    expect(
      aomiOAuthResources({ ...previewEnv, BETTER_AUTH_URL: auth.betterAuthUrl })
        .agentRest,
    ).toBe("https://chat-staging.aomi.dev/v1/agent");
  });

  it("does not treat an explicitly configured branch alias as an immutable preview issuer", () => {
    const auth = readAccountAuthEnv({
      ...previewEnv,
      BETTER_AUTH_URL: "https://chat-portal-git-feature-aomi-labs.vercel.app",
    });
    expect(auth.betterAuthUrl).toBe(
      "https://chat-portal-immutable-aomi-labs.vercel.app",
    );
  });
});
