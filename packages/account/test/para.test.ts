// @vitest-environment node

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import nestedFixture from "./fixtures/para-widget-nested.json";
import topLevelFixture from "./fixtures/para-widget-top-level.json";
import {
  createParaWidgetDescriptor,
  paraUserIdentifierType,
  verifyParaJwt,
  verifyParaWidgetCredential,
} from "../src/providers/para";
import { getWidgetProvider } from "../src/providers";

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL";

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

describe("Para login identifiers", () => {
  it("surfaces the verified login handle a wallet lookup is keyed by", async () => {
    // Para's wallet API is partner-scoped and indexed by the login handle, and
    // its `userIdentifierType` enum has no member for a Para user id — so the
    // `sub` cannot key a lookup and `data.authType` / `data.identifier` must
    // survive verification.
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const jwksUrl = "https://para.example/.well-known/identifier-jwks.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "id-kid", alg: "RS256" }] }),
      ),
    );
    const now = 1_900_000_000;
    const token = await new SignJWT({
      data: { authType: "telegram", identifier: "1234567890" },
    })
      .setProtectedHeader({ alg: "RS256", kid: "id-kid" })
      .setSubject("para-user-telegram")
      .setAudience("para-project")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    const identity = await verifyParaWidgetCredential({
      environment: "BETA",
      providerToken: token,
      jwksUrls: { BETA: jwksUrl, PROD: jwksUrl },
      now: new Date(now * 1000),
    });

    expect(identity.loginIdentifier).toEqual({
      type: "telegram",
      value: "1234567890",
    });
    expect(identity.walletAttestations).toEqual([]);
  });

  it("maps Para auth types onto the REST identifier enum and refuses the rest", () => {
    expect(paraUserIdentifierType("email")).toBe("EMAIL");
    expect(paraUserIdentifierType("Telegram")).toBe("TELEGRAM");
    expect(paraUserIdentifierType("x")).toBe("TWITTER");
    // An external wallet is not Para-custodied, so there is nothing to attest
    // and no identifier type that would name it.
    expect(paraUserIdentifierType("externalWallet")).toBeNull();
    expect(paraUserIdentifierType(undefined)).toBeNull();
  });
});

describe("Para token wallet attestations", () => {
  let jwksSeq = 0;

  async function verifyToken(data: Record<string, unknown>) {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    // A fresh JWKS URL per token: the verifier caches remote key sets by URL,
    // so reusing one would verify the second token against the first key.
    const jwksUrl = `https://para.example/.well-known/wallet-jwks-${jwksSeq++}.json`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "w-kid", alg: "RS256" }] }),
      ),
    );
    const now = 1_900_000_000;
    const token = await new SignJWT({ data })
      .setProtectedHeader({ alg: "RS256", kid: "w-kid" })
      .setSubject("para-user-wallets")
      .setAudience("para-project")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    return verifyParaWidgetCredential({
      environment: "BETA",
      providerToken: token,
      jwksUrls: { BETA: jwksUrl, PROD: jwksUrl },
      now: new Date(now * 1000),
    });
  }

  it("attests the embedded wallets Para signed into the token", async () => {
    // Para's REST wallet list is indexed by pregen login handle and cannot see
    // an SDK-created wallet, so this signed array is the only proof available
    // for a Mini App user. It carries the same signature as the `sub` the
    // canonical account is bound to.
    const identity = await verifyToken({
      wallets: [
        { id: "w-evm", type: "EVM", address: EVM },
        { id: "w-svm", type: "SOLANA", address: SOL },
      ],
    });

    expect(identity.walletAttestations).toEqual([
      {
        provider: "para",
        providerWalletId: "w-evm",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "w-svm",
        family: "svm",
        address: SOL,
        chainScope: null,
      },
    ]);
  });

  it("never attests a connected external wallet", async () => {
    // `connectedWallets` are wallets attached to the session, not custodied by
    // Para. They can never back hosted signing, so they stay out of the graph
    // even though they ride in the same signed token.
    const identity = await verifyToken({
      connectedWallets: [{ id: "w-external", type: "EVM", address: EVM }],
    });

    expect(identity.walletAttestations).toEqual([]);
  });

  it("drops malformed entries instead of trusting the shape", async () => {
    const identity = await verifyToken({
      wallets: [
        { id: "w-no-address", type: "EVM" },
        { id: "w-bad-address", type: "EVM", address: "0xnothex" },
        { id: "w-unsupported", type: "COSMOS", address: EVM },
        { type: "EVM", address: EVM },
      ],
    });

    expect(identity.walletAttestations).toEqual([]);
  });
});
