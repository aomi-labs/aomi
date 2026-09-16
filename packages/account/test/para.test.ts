// @vitest-environment node

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import nestedFixture from "./fixtures/para-widget-nested.json";
import topLevelFixture from "./fixtures/para-widget-top-level.json";
import {
  createParaWidgetDescriptor,
  verifyParaJwt,
  verifyParaWidgetCredential,
} from "../src/providers/para";
import { getWidgetProvider } from "../src/providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyParaJwt", () => {
  it("extracts email and wallets from the nested Para session data claim", async () => {
    // Para production tokens are RS256; verifyParaJwt now pins that algorithm.
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksUrl = "https://para.example/.well-known/jwks-test.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "para-kid", alg: "RS256" }] }),
      ),
    );
    const token = await new SignJWT({
      data: {
        email: "alice@example.com",
        identifier: "alice",
        authType: "OAUTH",
        oAuthMethod: "GOOGLE",
        wallets: [{ id: "evm-wallet", type: "EVM" }],
        connectedWallets: [{ id: "svm-wallet", type: "SOLANA" }],
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: "para-kid" })
      .setSubject("para-user-1")
      .setAudience("para-app")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyParaJwt({
        token,
        expectedAudience: "para-app",
        jwksUrl,
        keyId: "para-kid",
      }),
    ).resolves.toMatchObject({
      subject: "para-user-1",
      email: "alice@example.com",
      emailVerified: true,
      displayLabel: "alice@example.com",
      wallets: [{ id: "evm-wallet", type: "EVM" }],
      connectedWallets: [{ id: "svm-wallet", type: "SOLANA" }],
    });
  });
});

describe("Para widget credentials", () => {
  it("derives tenant identity from aud for both sanitized claim shapes", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksUrl = "https://para.example/.well-known/widget-jwks.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "widget-kid", alg: "RS256" }] }),
      ),
    );
    const now = 1_900_000_000;
    const tokens = await Promise.all(
      [topLevelFixture, nestedFixture].map((fixture) =>
        new SignJWT(fixture)
          .setProtectedHeader({ alg: "RS256", kid: "widget-kid" })
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey),
      ),
    );

    const identities = await Promise.all(
      tokens.map((providerToken) =>
        verifyParaWidgetCredential({
          environment: "BETA",
          providerToken,
          jwksUrls: { BETA: jwksUrl, PROD: jwksUrl },
          now: new Date(now * 1000),
        }),
      ),
    );

    expect(identities.map((identity) => identity.subject)).toEqual([
      "para-subject-shared",
      "para-subject-shared",
    ]);
    expect(identities.map((identity) => identity.tenantId)).toEqual([
      "para-project-alpha",
      "para-project-beta",
    ]);
    expect(identities.map((identity) => identity.issuerEnvironment)).toEqual([
      "para:beta",
      "para:beta",
    ]);
    expect(identities[0]?.walletAttestations).toEqual([]);
    expect(identities[1]?.walletAttestations).toEqual([]);
  });

  it("fails closed for a mismatched kid and disabled/unknown providers", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksUrl = "https://para.example/.well-known/widget-jwks-kid.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "actual-kid", alg: "RS256" }] }),
      ),
    );
    const now = 1_900_000_000;
    const providerToken = await new SignJWT(topLevelFixture)
      .setProtectedHeader({ alg: "RS256", kid: "actual-kid" })
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    const descriptor = createParaWidgetDescriptor({
      BETA: jwksUrl,
      PROD: jwksUrl,
    });

    await expect(
      descriptor.verifyWidgetCredential({
        environment: "BETA",
        providerToken,
        keyId: "wrong-kid",
      }),
    ).rejects.toThrow("provider_token_kid_mismatch");
    expect(descriptor.policy).toEqual({
      subjectIsEnvironmentGlobal: true,
      widgetEnabled: true,
    });
    expect(getWidgetProvider("missing-provider")).toBeNull();
    expect(getWidgetProvider("privy")?.policy.widgetEnabled).toBe(true);
    // Privy is widget-enabled but only in prod; a non-prod environment is
    // rejected before any token or network work.
    await expect(
      getWidgetProvider("privy")?.verifyWidgetCredential({
        environment: "BETA",
        providerToken: "unused",
      }),
    ).rejects.toThrow("invalid_provider_environment");
  });

  it("rejects missing claims, malformed wallet claims, and invalid environments", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksUrl = "https://para.example/.well-known/widget-jwks-invalid.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "invalid-kid", alg: "RS256" }] }),
      ),
    );
    const now = 1_900_000_000;
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "invalid-kid" })
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);
    const missingAudience = await sign({ sub: "subject" });
    const malformedWallets = await sign({
      sub: "subject",
      aud: "project",
      wallets: "not-an-array",
    });
    const verify = (providerToken: string, environment = "BETA") =>
      verifyParaWidgetCredential({
        environment,
        providerToken,
        jwksUrls: { BETA: jwksUrl, PROD: jwksUrl },
        now: new Date(now * 1000),
      });

    await expect(verify(missingAudience)).rejects.toThrow(
      "provider_token_invalid_aud",
    );
    await expect(verify(malformedWallets)).rejects.toThrow(
      "provider_token_invalid_wallets",
    );
    await expect(verify(malformedWallets, "STAGING")).rejects.toThrow(
      "invalid_provider_environment",
    );
  });
});
