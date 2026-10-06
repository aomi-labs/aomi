// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityConflictError } from "../src/service/identity-resolution";

const mockState = vi.hoisted(() => ({
  resolveError: null as Error | null,
  attachError: null as Error | null,
  resolvedUserId: "user-a",
  ownerId: "user-a" as string | null,
}));

const serviceMocks = vi.hoisted(() => ({
  betterAuthWalletSignals: vi.fn(async () => []),
  ensureAccountSchema: vi.fn(async () => undefined),
  fetchAttestedProviderWallets: vi.fn(async () => null),
  isIdentityAlreadyLinkedError: vi.fn(
    (error: unknown) =>
      error instanceof Error &&
      error.message === "identity_already_linked_to_another_account",
  ),
  linkProviderIdentity: vi.fn(async () => ({ status: "linked" })),
  mergeProviderWalletAttestations: vi.fn(
    (_primary, fallback) => fallback ?? [],
  ),
  syncProviderWallets: vi.fn(async () => ({ status: "linked" })),
}));

const queryMocks = vi.hoisted(() => ({
  buildAccountResponse: vi.fn(async ({ user }) => ({
    user,
    linkedAccounts: [],
    wallets: [],
    session: null,
  })),
  findAomiUserById: vi.fn(async (id) => ({ id })),
  findSignalOwner: vi.fn(async () => mockState.ownerId),
  upsertEmailIdentity: vi.fn(async () => ({ id: "email-row" })),
}));

vi.mock("../src/providers", () => ({
  createDefaultProviderCredentialVerifiers: vi.fn(),
  isVerifiedProviderTokenCredential: vi.fn(() => true),
  nativeProviderResolutionPolicy: vi.fn(() => ({
    subjectIsEnvironmentGlobal: true,
  })),
  providerSessionUserSeed: vi.fn(() => ({
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
  })),
  toVerifiedProviderIdentity: vi.fn((verified) => ({
    provider: verified.provider,
    issuerEnvironment: verified.issuerEnvironment,
    tenantId: verified.tenantId,
    subject: verified.token.subject,
    expiresAt: verified.token.expiresAt,
    email: {
      value: verified.token.email,
      verified: verified.token.emailVerified,
    },
    walletAttestations: verified.token.walletAttestations ?? [],
    metadata: verified.token.providerMetadata,
  })),
  verifyProviderCredential: vi.fn(async () => verifiedCredential()),
}));

vi.mock("../src/service/account-service", () => serviceMocks);
vi.mock("../src/db/queries", () => queryMocks);

vi.mock("../src/service/identity-resolution", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/service/identity-resolution")>();
  return {
    ...actual,
    resolveVerifiedProviderIdentity: vi.fn(async (input) => {
      if (mockState.resolveError) throw mockState.resolveError;
      const result = {
        user: { id: mockState.resolvedUserId },
        identity: { id: "provider-row" },
        created: mockState.resolvedUserId === "new-user",
      };
      await input.onResolved?.(result as never, { tx: true } as never);
      return result;
    }),
    attachVerifiedProviderIdentityToUser: vi.fn(async (input) => {
      if (mockState.attachError) throw mockState.attachError;
      await input.onAttached?.(
        { id: "provider-row" } as never,
        { tx: true } as never,
      );
      return { id: "provider-row" };
    }),
  };
});

import {
  exchangeProviderForExistingSession,
  linkVerifiedProviderCredentialForUser,
  signInWithVerifiedProviderCredential,
} from "../src/service/provider-exchange";

function verifiedCredential() {
  return {
    provider: "para" as const,
    walletAttestationProvider: "para" as const,
    issuerEnvironment: "para:beta",
    tenantId: "project-a",
    token: {
      subject: "para-user",
      expiresAt: 2_000_000_000,
      email: "alice@example.com",
      emailVerified: true,
      providerMetadata: {},
      walletAttestations: [
        {
          provider: "para" as const,
          providerWalletId: "wallet-1",
          family: "evm" as const,
          address: "0x0000000000000000000000000000000000000001",
          chainScope: null,
        },
      ],
    },
  };
}

describe("provider sign-in and linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveError = null;
    mockState.attachError = null;
    mockState.resolvedUserId = "user-a";
    mockState.ownerId = "user-a";
    serviceMocks.mergeProviderWalletAttestations.mockImplementation(
      (_primary, fallback) => fallback ?? [],
    );
    serviceMocks.linkProviderIdentity.mockResolvedValue({ status: "linked" });
    serviceMocks.syncProviderWallets.mockResolvedValue({ status: "linked" });
  });

  it("makes no canonical writes when identity and wallet signals have different owners", async () => {
    mockState.resolveError = new IdentityConflictError(
      ["user-a", "user-b"],
      "wallet",
    );

    await expect(
      signInWithVerifiedProviderCredential({
        betterAuthUserId: "ba-user-1",
        verified: verifiedCredential(),
      }),
    ).resolves.toEqual({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "wallet",
    });
    expect(serviceMocks.linkProviderIdentity).not.toHaveBeenCalled();
    expect(serviceMocks.syncProviderWallets).not.toHaveBeenCalled();
    expect(queryMocks.upsertEmailIdentity).not.toHaveBeenCalled();
  });

  it("signs into the one existing account selected by all signals", async () => {
    await expect(
      signInWithVerifiedProviderCredential({
        betterAuthUserId: "ba-user-1",
        verified: verifiedCredential(),
        name: "Alice",
      }),
    ).resolves.toMatchObject({
      status: "linked",
      user: { id: "user-a" },
    });
    expect(serviceMocks.linkProviderIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        provider: "better_auth",
        db: { tx: true },
      }),
    );
    expect(serviceMocks.syncProviderWallets).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", db: { tx: true } }),
    );
  });

  it("creates a new account only when no signal has an owner", async () => {
    mockState.resolvedUserId = "new-user";

    await expect(
      signInWithVerifiedProviderCredential({
        betterAuthUserId: "ba-new",
        verified: verifiedCredential(),
      }),
    ).resolves.toMatchObject({
      status: "linked",
      user: { id: "new-user" },
    });
  });

  it("does not transfer a provider or wallet during authenticated linking", async () => {
    mockState.attachError = new IdentityConflictError(
      ["user-a", "user-b"],
      "identity",
    );

    await expect(
      linkVerifiedProviderCredentialForUser({
        userId: "user-b",
        verified: verifiedCredential(),
      }),
    ).resolves.toEqual({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "identity",
    });
    expect(serviceMocks.syncProviderWallets).not.toHaveBeenCalled();
  });

  it("allows linking after the other account has manually unlinked the signal", async () => {
    mockState.attachError = new IdentityConflictError(
      ["user-a", "user-b"],
      "identity",
    );
    const input = {
      userId: "user-b",
      verified: verifiedCredential(),
    };

    await expect(
      linkVerifiedProviderCredentialForUser(input),
    ).resolves.toMatchObject({ status: "conflict" });

    mockState.attachError = null;
    await expect(
      linkVerifiedProviderCredentialForUser(input),
    ).resolves.toMatchObject({
      status: "linked",
      user: { id: "user-b" },
    });
    expect(serviceMocks.syncProviderWallets).toHaveBeenCalledTimes(1);
  });

  it("uses the signed-in canonical owner instead of resolving or creating another account", async () => {
    await expect(
      exchangeProviderForExistingSession({
        betterAuthUserId: "ba-user-1",
        currentUserId: "user-a",
        credential: { provider: "para", providerToken: "token" },
      }),
    ).resolves.toMatchObject({
      status: "linked",
      account: { user: { id: "user-a" } },
    });
  });

  it("fails closed when the BetterAuth carrier does not belong to the asserted current account", async () => {
    mockState.ownerId = "user-a";

    await expect(
      exchangeProviderForExistingSession({
        betterAuthUserId: "ba-user-1",
        currentUserId: "user-b",
        credential: { provider: "para", providerToken: "token" },
      }),
    ).resolves.toEqual({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "identity",
    });
    expect(serviceMocks.syncProviderWallets).not.toHaveBeenCalled();
  });
});
