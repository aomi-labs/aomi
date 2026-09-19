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
  resolveAttestedProviderWallets,
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

describe("resolveAttestedProviderWallets", () => {
  afterEach(() => setAccountInternalFailureObserver(undefined));

  const wallets: AttestedWallet[] = [
    {
      provider: "custom",
      providerWalletId: "w-1",
      family: "evm",
      address: EVM,
      chainScope: null,
    },
  ];

  it("reports what the provider attested", async () => {
    await expect(
      resolveAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters: { custom: async () => wallets },
      }),
    ).resolves.toEqual({ status: "attested", wallets });
  });

  // "the provider says this user owns no embedded wallet" is an answer, and a
  // caller that requires a hosted wallet must be able to tell it apart from
  // "we never got an answer" — the two collapse to `null` in the legacy
  // `fetchAttestedProviderWallets` contract.
  it("keeps an empty attestation distinct from no answer", async () => {
    await expect(
      resolveAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters: { custom: async () => [] },
      }),
    ).resolves.toEqual({ status: "attested", wallets: [] });

    await expect(
      resolveAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters: {},
      }),
    ).resolves.toEqual({ status: "unconfigured" });
  });

  it("reports a failed provider fetch as unavailable and observes it", async () => {
    const error = new Error("provider down");
    const observer = vi.fn();
    setAccountInternalFailureObserver(observer);

    await expect(
      resolveAttestedProviderWallets({
        provider: "custom",
        subject: "provider-user",
        attesters: {
          custom: async () => {
            throw error;
          },
        },
      }),
    ).resolves.toEqual({ status: "unavailable", error });
    expect(observer).toHaveBeenCalledWith({ kind: "provider_wallets", error });
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

describe("the Para attester's lookup key", () => {
  const paraEnv: AccountAuthEnv = { ...baseEnv, paraApiKey: "para-secret" };

  function stubWalletApi(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [], pagination: { cursor: null, hasMore: false } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("asks Para by the verified login handle, not by the token subject", async () => {
    // Para's `userIdentifierType` enum names login handles only; querying a
    // Para user id as a CUSTOM_ID matches nothing, which is how a linked Para
    // identity ended up with no hosted wallet behind it.
    const fetchMock = stubWalletApi();

    await createDefaultWalletAttesters(paraEnv).para?.({
      subject: "d5358219-38d3-4650-91a8-e338131d1c5e",
      email: "alice@example.com",
      loginIdentifier: { type: "telegram", value: "1234567890" },
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("userIdentifier")).toBe("1234567890");
    expect(url.searchParams.get("userIdentifierType")).toBe("TELEGRAM");
  });

  it("falls back to a verified email, then to a CUSTOM_ID subject", async () => {
    const fetchMock = stubWalletApi();
    const para = createDefaultWalletAttesters(paraEnv).para;

    await para?.({ subject: "para-user", email: "alice@example.com" });
    await para?.({ subject: "para-user" });

    const [byEmail, bySubject] = fetchMock.mock.calls.map(
      (call) => new URL(String(call[0])).searchParams,
    );
    expect(byEmail?.get("userIdentifier")).toBe("alice@example.com");
    expect(byEmail?.get("userIdentifierType")).toBe("EMAIL");
    expect(bySubject?.get("userIdentifier")).toBe("para-user");
    expect(bySubject?.get("userIdentifierType")).toBe("CUSTOM_ID");
  });

  it("answers null — never an empty wallet set — for an unqueryable login", async () => {
    // An `externalWallet` login has no Para-custodied wallet to attest and no
    // identifier type that names it. Reporting "no answer" keeps a caller that
    // requires a hosted wallet from reading this as "the user owns none".
    const fetchMock = stubWalletApi();

    await expect(
      createDefaultWalletAttesters(paraEnv).para?.({
        subject: "para-user",
        loginIdentifier: {
          type: "externalWallet",
          value: "0xaD6b78193b78e23F9aBBB675734f4a2B3559598D",
        },
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
