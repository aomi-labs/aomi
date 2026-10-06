// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
  buildAccountResponse: vi.fn(),
  clearAomiBetterAuthUserIds: vi.fn(),
  countLoginFactors: vi.fn(),
  createAomiUser: vi.fn(),
  deactivateAomiUser: vi.fn(),
  deleteBetterAuthSiweWallet: vi.fn(),
  deleteBetterAuthSiwsWallet: vi.fn(),
  findAuthIdentityById: vi.fn(),
  findAomiUserById: vi.fn(),
  findAomiUserByBetterAuthId: vi.fn(),
  findLegacyBackendUserIdByWallet: vi.fn(),
  findProviderSubjectOwners: vi.fn(),
  findSignalOwner: vi.fn(),
  findWalletById: vi.fn(),
  listBetterAuthSiweWallets: vi.fn(),
  listBetterAuthSiwsWallets: vi.fn(),
  listWalletsForUser: vi.fn(),
  lockIdentityResolutionKeys: vi.fn(),
  logAccountEvent: vi.fn(),
  revokeAllAuthIdentitiesForUser: vi.fn(),
  revokeAllWalletsForUser: vi.fn(),
  revokeAuthIdentity: vi.fn(),
  revokeWallet: vi.fn(),
  runAomiAuthSchema: vi.fn(),
  touchAomiUser: vi.fn(),
  updateAuthIdentityLabel: vi.fn(),
  updateAomiUserProfile: vi.fn(),
  updateWalletLabel: vi.fn(),
  upsertAuthIdentity: vi.fn(),
  upsertEmailIdentity: vi.fn(),
  upsertWallet: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../src/db/queries", () => queryMocks);

describe("getOrCreateAomiUserForBetterAuthSession adoption", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("links a verified provider email without overwriting the canonical profile", async () => {
    const db = { tag: "transaction-client" };
    queryMocks.runAomiAuthSchema.mockResolvedValue(undefined);
    queryMocks.findSignalOwner.mockResolvedValue(null);
    queryMocks.upsertAuthIdentity.mockResolvedValue({ id: "provider-row" });
    queryMocks.upsertEmailIdentity.mockResolvedValue({ id: "email-row" });

    const { linkProviderIdentity } =
      await import("../src/service/account-service");
    await expect(
      linkProviderIdentity({
        userId: "canonical-user",
        provider: "para",
        issuerEnvironment: "para:beta",
        tenantId: "project-a",
        subject: "provider-subject",
        email: "claimed@example.com",
        emailVerified: true,
        db: db as never,
      }),
    ).resolves.toMatchObject({ status: "linked" });

    expect(queryMocks.upsertEmailIdentity).toHaveBeenCalledWith({
      userId: "canonical-user",
      email: "claimed@example.com",
      db,
    });
    expect(queryMocks.updateAomiUserProfile).not.toHaveBeenCalled();
  });

  it("preserves an existing wallet-keyed canonical UUID on first BetterAuth SIWE login", async () => {
    const legacyUserId = "2f7d9690-10aa-49f2-9f20-067aa8cc9a17";
    const db = { tag: "transaction-client" };
    queryMocks.runAomiAuthSchema.mockResolvedValue(undefined);
    queryMocks.withTransaction.mockImplementation(async (fn) => fn(db));
    queryMocks.findProviderSubjectOwners.mockResolvedValue([]);
    queryMocks.findAomiUserByBetterAuthId.mockResolvedValue(null);
    queryMocks.listBetterAuthSiweWallets.mockResolvedValue([
      {
        betterAuthUserId: "ba-user-1",
        address: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
        chainId: 1,
        isPrimary: true,
        createdAt: new Date(),
      },
    ]);
    queryMocks.listBetterAuthSiwsWallets.mockResolvedValue([]);
    queryMocks.findSignalOwner.mockImplementation(async (signal) =>
      signal.type === "wallet" ? legacyUserId : null,
    );
    queryMocks.findAomiUserById.mockResolvedValue({ id: legacyUserId });
    queryMocks.updateAomiUserProfile.mockResolvedValue({ id: legacyUserId });

    const { getOrCreateAomiUserForBetterAuthSession } =
      await import("../src/service/account-service");

    const user = await getOrCreateAomiUserForBetterAuthSession({
      betterAuthUserId: "ba-user-1",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
    });

    expect(user.id).toBe(legacyUserId);
    expect(queryMocks.createAomiUser).not.toHaveBeenCalled();
    expect(queryMocks.upsertAuthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: legacyUserId,
        provider: "better_auth",
        subject: "ba-user-1",
        db,
      }),
    );
  });

  it("adopts an existing canonical user on first BetterAuth SIWS login", async () => {
    const canonicalUser = {
      id: "1f2d9690-10aa-49f2-9f20-067aa8cc9a99",
    };
    const db = { tag: "transaction-client" };
    queryMocks.runAomiAuthSchema.mockResolvedValue(undefined);
    queryMocks.withTransaction.mockImplementation(async (fn) => fn(db));
    queryMocks.findProviderSubjectOwners.mockResolvedValue([]);
    queryMocks.findAomiUserByBetterAuthId.mockResolvedValue(null);
    queryMocks.listBetterAuthSiweWallets.mockResolvedValue([]);
    queryMocks.listBetterAuthSiwsWallets.mockResolvedValue([
      {
        betterAuthUserId: "ba-solana-user",
        address: "CB3XMCCSTp9U9vnQerN8yoqazSt8MPgGvoS1gunYXL8v",
        createdAt: new Date(),
      },
    ]);
    queryMocks.findSignalOwner.mockResolvedValue(canonicalUser.id);
    queryMocks.findAomiUserById.mockResolvedValue(canonicalUser);

    const { getOrCreateAomiUserForBetterAuthSession } =
      await import("../src/service/account-service");
    const user = await getOrCreateAomiUserForBetterAuthSession({
      betterAuthUserId: "ba-solana-user",
    });

    expect(user.id).toBe(canonicalUser.id);
    expect(queryMocks.findSignalOwner).toHaveBeenCalledWith(
      {
        type: "wallet",
        family: "svm",
        normalizedAddress: "CB3XMCCSTp9U9vnQerN8yoqazSt8MPgGvoS1gunYXL8v",
        chainScope: null,
      },
      db,
    );
    expect(queryMocks.upsertAuthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: canonicalUser.id,
        provider: "better_auth",
        subject: "ba-solana-user",
      }),
    );
  });
});
