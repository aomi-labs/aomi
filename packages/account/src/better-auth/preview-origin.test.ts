// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  previewWalletAuthOrigin,
  withPreviewWalletAuthOrigin,
} from "../src/better-auth/preview-origin";

const env = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "portal-immutable-aomi-labs.vercel.app",
  VERCEL_BRANCH_URL: "portal-git-feature-aomi-labs.vercel.app",
};
const canonical = "https://chat-staging.aomi.dev";

describe("preview wallet auth origin", () => {
  it("keeps simultaneous preview signature verifications bound to their own request host", async () => {
    const hosts = [
      "portal-immutable-aomi-labs.vercel.app",
      "portal-git-feature-aomi-labs.vercel.app",
      "chat-staging.aomi.dev",
    ];
    const observed = await Promise.all(
      hosts.map((host) =>
        withPreviewWalletAuthOrigin(
          new Request(`https://${host}/api/auth/siwe/verify`),
          env,
          canonical,
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return previewWalletAuthOrigin();
          },
        ),
      ),
    );
    expect(observed).toEqual(hosts.map((host) => `https://${host}`));
    expect(previewWalletAuthOrigin()).toBeUndefined();
  });

  it("rejects an unconfigured host even when it claims an allowed Origin", () => {
    let called = false;
    const result = withPreviewWalletAuthOrigin(
      new Request("https://attacker.example/api/auth/siwe/verify", {
        headers: { origin: canonical },
      }),
      env,
      canonical,
      () => {
        called = true;
      },
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(called).toBe(false);
  });

  it("leaves production wallet auth on the configured domain", () => {
    const result = withPreviewWalletAuthOrigin(
      new Request("https://chat.aomi.dev/api/auth/siwe/verify"),
      { VERCEL_ENV: "production" },
      "https://chat.aomi.dev",
      () => previewWalletAuthOrigin() ?? "configured-domain",
    );
    expect(result).toBe("configured-domain");
  });

  it("supplies the preview host to the installed Better Auth SIWE verifier", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    };
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/aomi";
    process.env.BETTER_AUTH_URL = canonical;
    try {
      const { auth } = await import("../src/better-auth/auth");
      const siwe = auth.options.plugins?.find(
        (plugin) => plugin.id === "siwe",
      ) as { options: { domain: string } } | undefined;
      expect(siwe).toBeDefined();
      expect(siwe!.options.domain).toBe("chat-staging.aomi.dev");
      const domain = withPreviewWalletAuthOrigin(
        new Request(`https://${env.VERCEL_BRANCH_URL}/api/auth/siwe/verify`),
        env,
        canonical,
        () => siwe!.options.domain,
      );
      expect(domain).toBe(env.VERCEL_BRANCH_URL);
      expect(siwe!.options.domain).toBe("chat-staging.aomi.dev");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
