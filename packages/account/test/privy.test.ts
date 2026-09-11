// @vitest-environment node

import { describe, expect, it } from "vitest";
import { verifyPrivyToken } from "../src/providers/privy";

describe("verifyPrivyToken", () => {
  it("extracts email from verified identity-token accounts", async () => {
    await expect(
      verifyPrivyToken(
        {
          token: "identity-token",
          tokenKind: "identity_token",
          appId: "privy-app",
        },
        {
          verifyAccessToken: async () => {
            throw new Error("unexpected access-token verification");
          },
          verifyIdentityToken: async () => ({
            payload: {
              sub: "did:privy:alice",
              aud: "privy-app",
              iss: "privy.io",
              exp: 4_102_444_800,
            },
            linkedAccounts: [
              {
                type: "wallet",
                address: "0x1111111111111111111111111111111111111111",
              },
              {
                type: "google_oauth",
                email: "alice@example.com",
              },
            ],
          }),
        },
      ),
    ).resolves.toMatchObject({
      subject: "did:privy:alice",
      email: "alice@example.com",
      emailVerified: true,
      displayLabel: "alice@example.com",
    });
  });

  it("maps verified access-token claims", async () => {
    await expect(
      verifyPrivyToken(
        {
          token: "access-token",
          tokenKind: "access_token",
          appId: "privy-app",
        },
        {
          verifyAccessToken: async () => ({
            userId: "did:privy:alice",
            sessionId: "session-id",
            expiration: 4_102_444_800,
          }),
          verifyIdentityToken: async () => {
            throw new Error("unexpected identity-token verification");
          },
        },
      ),
    ).resolves.toMatchObject({
      subject: "did:privy:alice",
      sessionId: "session-id",
      expiresAt: 4_102_444_800,
    });
  });
});
