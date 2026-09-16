// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createDefaultProviderCredentialVerifiers,
  paraTokenWalletAttestations,
  providerSessionUserSeed,
  privyTokenWalletAttestations,
  verifyProviderCredential,
} from "../src/providers/account-credentials";
import { readAccountAuthEnv } from "../src/better-auth/env";
import type { AccountAuthEnv } from "../src/better-auth/env";

const baseEnv: AccountAuthEnv = {
  betterAuthSecret: "secret",
  betterAuthUrl: "http://localhost:3001",
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/aomi",
  siweDomain: "localhost:3001",
  trustedOrigins: ["http://localhost:3001"],
};

describe("verifyProviderCredential", () => {
  it("accepts a Privy provider verifier override", async () => {
    const verifier = vi.fn(async () => ({
      provider: "privy",
      walletAttestationProvider: "privy",
      token: {
        subject: "did:privy:user-1",
        expiresAt: 4_102_444_800,
        email: "privy@example.com",
        emailVerified: true,
        displayLabel: "Privy Person",
        providerMetadata: { source: "test" },
      },
    }));

    const result = await verifyProviderCredential(
      {
        provider: "privy",
        providerToken: "privy-token",
      },
      { verifiers: { privy: verifier } },
    );

    expect(verifier).toHaveBeenCalledWith({
      provider: "privy",
      tokenKind: undefined,
      providerToken: "privy-token",
    });
    expect(result).toEqual({
      provider: "privy",
      walletAttestationProvider: "privy",
      token: {
        subject: "did:privy:user-1",
        expiresAt: 4_102_444_800,
        email: "privy@example.com",
        emailVerified: true,
        displayLabel: "Privy Person",
        providerMetadata: { source: "test" },
      },
    });
  });

  it("can still build the default Privy/Para verifier registry from env", () => {
    const verifiers = createDefaultProviderCredentialVerifiers({
      ...baseEnv,
      privyAppId: "privy-app",
      paraAudience: "para-app",
      paraJwksUrl: "https://example.com/.well-known/jwks.json",
    });

    expect(verifiers.privy).toEqual(expect.any(Function));
    expect(verifiers.para).toEqual(expect.any(Function));
  });

  it("prefers the explicit Para JWT audience over the public API key", () => {
    const env = readAccountAuthEnv({
      BETTER_AUTH_URL: "http://localhost:3001",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/aomi",
      PARA_JWT_AUDIENCE: "para-audience-uuid",
      NEXT_PUBLIC_PARA_API_KEY: "beta_public_api_key",
      BETTER_AUTH_SECRET: "test-secret",
      NODE_ENV: "test",
    });

    expect(env.paraAudience).toBe("para-audience-uuid");
  });
});

describe("token wallet attestations", () => {
  it("normalizes Para JWT wallet rows as embedded wallet attestations", () => {
    expect(
      paraTokenWalletAttestations([
        {
          id: "evm-wallet",
          type: "EVM",
          address: "0xe7749cf819d324b54d2a04c710fa4d17929107a6",
        },
        {
          id: "svm-wallet",
          type: "SOLANA",
          address: "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL",
        },
        {
          id: "bad-wallet",
          type: "EVM",
          address: "not-an-address",
        },
      ]),
    ).toEqual([
      {
        provider: "para",
        providerWalletId: "evm-wallet",
        family: "evm",
        address: "0xe7749cf819d324b54d2a04c710fa4d17929107a6",
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "svm-wallet",
        family: "svm",
        address: "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL",
        chainScope: null,
      },
    ]);
  });

  it("only trusts clearly embedded Privy wallet rows from token metadata", () => {
    expect(
      privyTokenWalletAttestations([
        {
          id: "embedded-evm",
          type: "wallet",
          wallet_client_type: "privy",
          chain_type: "ethereum",
          address: "0x1111111111111111111111111111111111111111",
        },
        {
          id: "external-evm",
          type: "wallet",
          wallet_client_type: "metamask",
          chain_type: "ethereum",
          address: "0x2222222222222222222222222222222222222222",
        },
      ]),
    ).toEqual([
      {
        provider: "privy",
        providerWalletId: "embedded-evm",
        family: "evm",
        address: "0x1111111111111111111111111111111111111111",
        chainScope: null,
      },
    ]);
  });
});

describe("providerSessionUserSeed", () => {
  it("uses verified provider email for BetterAuth session lookup", () => {
    expect(
      providerSessionUserSeed({
        provider: "privy",
        walletAttestationProvider: "privy",
        token: {
          subject: "did:privy:user-1",
          expiresAt: 4_102_444_800,
          email: "person@example.com",
          emailVerified: true,
          providerMetadata: {},
        },
      }),
    ).toEqual({
      email: "person@example.com",
      emailVerified: true,
      name: "person@example.com",
    });
  });

  it("uses a provider-subject email when provider email is unverified", () => {
    expect(
      providerSessionUserSeed({
        provider: "para",
        walletAttestationProvider: "para",
        token: {
          subject: "para:user/123",
          expiresAt: 4_102_444_800,
          email: "claimed@example.com",
          emailVerified: false,
          providerMetadata: {},
        },
      }),
    ).toEqual({
      email: "para-para_user_123@auth.aomi.local",
      emailVerified: false,
      name: "para user",
    });
  });

  it("uses provider display label for synthetic-email BetterAuth users", () => {
    expect(
      providerSessionUserSeed({
        provider: "privy",
        walletAttestationProvider: "privy",
        token: {
          subject: "did:privy:user-1",
          expiresAt: 4_102_444_800,
          displayLabel: "alice",
          providerMetadata: {},
        },
      }),
    ).toEqual({
      email: "privy-did_privy_user-1@auth.aomi.local",
      emailVerified: false,
      name: "alice",
    });
  });
});
