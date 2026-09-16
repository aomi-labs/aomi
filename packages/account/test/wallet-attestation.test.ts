// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountAuthEnv } from "../src/better-auth/env";
import { createDefaultWalletAttesters } from "../src/providers/default-wallet-attesters";
import {
  type AttestedWallet,
  type WalletAttesterRegistry,
} from "../src/providers/wallet-attestation";
import {
  fetchAttestedProviderWallets,
  mergeProviderWalletAttestations,
} from "../src/service/account-service";
import { setAccountInternalFailureObserver } from "../src/observability";

const EVM = "0x1111111111111111111111111111111111111111";
const EVM2 = "0x2222222222222222222222222222222222222222";
const SOL = "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL";

const baseEnv: AccountAuthEnv = {
  betterAuthSecret: "secret",
  betterAuthUrl: "http://localhost:3001",
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/aomi",
  siweDomain: "localhost:3001",
  trustedOrigins: ["http://localhost:3001"],
};

describe("fetchAttestedProviderWallets", () => {
  afterEach(() => setAccountInternalFailureObserver(undefined));

  it("fetches wallets from a provider registry", async () => {
    const wallets: AttestedWallet[] = [
      {
        provider: "custom",
        providerWalletId: "w-1",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
    ];
    const attester = vi.fn(async () => wallets);

    const result = await fetchAttestedProviderWallets({
      provider: "custom",
      subject: "provider-user",
      email: "user@example.com",
      attesters: { custom: attester },
    });

    expect(result).toEqual(wallets);
    expect(attester).toHaveBeenCalledWith({
      subject: "provider-user",
      email: "user@example.com",
    });
  });

  it("returns null when no attester is registered", async () => {
    await expect(
      fetchAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters: {},
      }),
    ).resolves.toBeNull();
  });

  it("observes the original error and returns null when the provider fetch fails", async () => {
    const error = new Error("provider down");
    const observer = vi.fn();
    setAccountInternalFailureObserver(observer);
    const attesters: WalletAttesterRegistry = {
      custom: async () => {
        throw error;
      },
    };

    await expect(
      fetchAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters,
      }),
    ).resolves.toBeNull();
    expect(observer).toHaveBeenCalledWith({ kind: "provider_wallets", error });
  });

  it("preserves an explicitly supplied diagnostic logger", async () => {
    const error = new Error("provider down");
    const logger = { warn: vi.fn() };

    await fetchAttestedProviderWallets({
      provider: "custom",
      subject: "provider-user",
      attesters: {
        custom: async () => {
          throw error;
        },
      },
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "syncProviderWallets: failed to list custom wallets for provider-user",
      error,
    );
  });
});

describe("mergeProviderWalletAttestations", () => {
  it("keeps provider API rows and fills missing token-attested wallets", () => {
    expect(
      mergeProviderWalletAttestations(
        [
          {
            provider: "para",
            providerWalletId: "api-evm",
            family: "evm",
            address: EVM,
            chainScope: null,
          },
        ],
        [
          {
            provider: "para",
            providerWalletId: "token-evm",
            family: "evm",
            address: `0x${EVM.slice(2).toUpperCase()}`,
            chainScope: null,
          },
          {
            provider: "para",
            providerWalletId: "token-svm",
            family: "svm",
            address: SOL,
            chainScope: null,
          },
          {
            provider: "para",
            providerWalletId: "token-evm-2",
            family: "evm",
            address: EVM2,
            chainScope: null,
          },
        ],
      ),
    ).toEqual([
      {
        provider: "para",
        providerWalletId: "api-evm",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "token-svm",
        family: "svm",
        address: SOL,
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "token-evm-2",
        family: "evm",
        address: EVM2,
        chainScope: null,
      },
    ]);
  });
});

describe("createDefaultWalletAttesters", () => {
  it("only registers providers with server credentials", () => {
    expect(createDefaultWalletAttesters(baseEnv)).toEqual({});

    const privy = createDefaultWalletAttesters({
      ...baseEnv,
      privyAppId: "privy-app",
      privyAppSecret: "privy-secret",
    });
    expect(privy.privy).toEqual(expect.any(Function));
    expect(privy.para).toBeUndefined();

    const para = createDefaultWalletAttesters({
      ...baseEnv,
      paraApiKey: "para-secret",
    });
    expect(para.privy).toBeUndefined();
    expect(para.para).toEqual(expect.any(Function));
  });
});
