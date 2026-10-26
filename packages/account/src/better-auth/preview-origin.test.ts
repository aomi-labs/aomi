// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  previewWalletAuthOrigin,
  withPreviewWalletAuthOrigin,
} from "./preview-origin";

const env = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "portal-immutable-aomi-labs.vercel.app",
  VERCEL_BRANCH_URL: "portal-git-feature-aomi-labs.vercel.app",
};
const canonical = "https://chat-staging.aomi.dev";

describe("preview wallet auth origin", () => {
  it.each(["siwe/nonce", "siwe/verify", "siws/nonce", "siws/verify"])(
    "binds an Edge-proxied %s request to the configured public origin",
    (path) => {
      const observed = withPreviewWalletAuthOrigin(
        new Request(`https://${env.VERCEL_BRANCH_URL}/api/auth/${path}`, {
          headers: { origin: canonical },
        }),
        env,
        canonical,
        () => previewWalletAuthOrigin(),
      );
      expect(observed).toBe(canonical);
    },
  );

  it("keeps direct preview login on its own origin", () => {
    const origin = `https://${env.VERCEL_BRANCH_URL}`;
    const observed = withPreviewWalletAuthOrigin(
      new Request(`${origin}/api/auth/siwe/verify`, { headers: { origin } }),
      env,
      canonical,
      () => previewWalletAuthOrigin(),
    );
    expect(observed).toBe(origin);
  });

  it.each([
    "https://attacker.example",
    "null",
    `${canonical}.attacker.example`,
    `${canonical}/`,
  ])(
    "rejects an unconfigured browser origin %s on an allowed transport",
    (origin) => {
      let called = false;
      const result = withPreviewWalletAuthOrigin(
        new Request(`https://${env.VERCEL_BRANCH_URL}/api/auth/siws/verify`, {
          headers: { origin, "x-forwarded-host": "chat-staging.aomi.dev" },
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
    },
  );

  it("does not select a wallet origin from forwarded headers", () => {
    const observed = withPreviewWalletAuthOrigin(
      new Request(`https://${env.VERCEL_BRANCH_URL}/api/auth/siwe/verify`, {
        headers: {
          "x-forwarded-host": "chat-staging.aomi.dev",
          "x-forwarded-proto": "https",
          forwarded: 'host="chat-staging.aomi.dev";proto=https',
        },
      }),
      env,
      canonical,
      () => previewWalletAuthOrigin(),
    );
    expect(observed).toBe(`https://${env.VERCEL_BRANCH_URL}`);
  });

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
      const { auth } = await import("./auth");
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
      const edgeDomain = withPreviewWalletAuthOrigin(
        new Request(`https://${env.VERCEL_BRANCH_URL}/api/auth/siwe/verify`, {
          headers: { origin: canonical },
        }),
        env,
        canonical,
        () => siwe!.options.domain,
      );
      expect(edgeDomain).toBe("chat-staging.aomi.dev");
      expect(siwe!.options.domain).toBe("chat-staging.aomi.dev");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
