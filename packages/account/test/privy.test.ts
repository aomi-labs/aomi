// @vitest-environment node

import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createPrivyAccessTokenVerifier,
  verifyPrivyToken,
} from "../src/providers/privy";

describe("createPrivyAccessTokenVerifier", () => {
  it("verifies issuer, audience, signature, subject, session, and expiration", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwtVerificationKey = await exportSPKI(publicKey);
    const verify = createPrivyAccessTokenVerifier({
      appId: "privy-app",
      jwtVerificationKey,
    });
    const accessToken = await new SignJWT({ sid: "session-id" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("did:privy:alice")
      .setIssuer("privy.io")
      .setAudience("privy-app")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verify(accessToken)).resolves.toMatchObject({
      userId: "did:privy:alice",
      sessionId: "session-id",
    });
  });
});

describe("verifyPrivyToken", () => {
  it("extracts email from stringified linked accounts on identity tokens", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const identityTokenVerificationKey = await exportSPKI(publicKey);
    const token = await new SignJWT({
      linked_accounts: JSON.stringify([
        {
          type: "wallet",
          address: "0x1111111111111111111111111111111111111111",
        },
        {
          type: "google_oauth",
          email: "alice@example.com",
        },
      ]),
    })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("did:privy:alice")
      .setIssuer("privy.io")
      .setAudience("privy-app")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyPrivyToken({
        token,
        tokenKind: "identity_token",
        appId: "privy-app",
        identityTokenVerificationKey,
      }),
    ).resolves.toMatchObject({
      subject: "did:privy:alice",
      email: "alice@example.com",
      emailVerified: true,
      displayLabel: "alice@example.com",
    });
  });
});
