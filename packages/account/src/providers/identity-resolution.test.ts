// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedProviderIdentity } from "../src/providers/descriptor";

const queryMocks = vi.hoisted(() => ({
  createAomiUser: vi.fn(),
  findAomiUserById: vi.fn(),
  findProviderSubjectOwners: vi.fn(),
  findSignalOwner: vi.fn(),
  lockIdentityResolutionKeys: vi.fn(),
  touchAomiUser: vi.fn(),
  upsertAuthIdentity: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../src/db/queries", () => queryMocks);

import {
  attachVerifiedProviderIdentityToUser,
  IdentityConflictError,
  resolveVerifiedProviderIdentity,
} from "../src/service/identity-resolution";

const globalPolicy = {
  subjectIsEnvironmentGlobal: true,
};

function identity(tenantId: string): VerifiedProviderIdentity {
  return {
    provider: "para",
    issuerEnvironment: "para:beta",
    tenantId,
    subject: "shared-subject",
    expiresAt: 2_000_000_000,
    walletAttestations: [],
    metadata: {},
  };
}

describe("tenant-scoped identity resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMocks.withTransaction.mockImplementation(async (fn) =>
      fn({ tx: true }),
    );
    queryMocks.findSignalOwner.mockResolvedValue(null);
    queryMocks.findProviderSubjectOwners.mockResolvedValue([]);
    queryMocks.findAomiUserById.mockImplementation(async (id) => ({ id }));
    queryMocks.createAomiUser.mockResolvedValue({ id: "new-user" });
    queryMocks.upsertAuthIdentity.mockImplementation(async (input) => ({
      id: `${input.tenantId}-identity`,
      userId: input.userId,
      provider: input.provider,
      issuerEnvironment: input.issuerEnvironment,
      tenantId: input.tenantId,
      subject: input.subject,
    }));
  });

  it("reuses an exact tenant identity", async () => {
    queryMocks.findSignalOwner.mockResolvedValue("user-a");
    const result = await resolveVerifiedProviderIdentity({
      identity: identity("project-a"),
      policy: globalPolicy,
    });

    expect(result).toMatchObject({ created: false, user: { id: "user-a" } });
    expect(queryMocks.createAomiUser).not.toHaveBeenCalled();
  });

  it("creates once, records the exact credential, and preserves the new UUID", async () => {
    queryMocks.createAomiUser.mockResolvedValue({ id: "stable-user-id" });
    const result = await resolveVerifiedProviderIdentity({
      identity: identity("project-a"),
      policy: globalPolicy,
    });

    expect(result).toMatchObject({
      created: true,
      user: { id: "stable-user-id" },
      identity: { userId: "stable-user-id", tenantId: "project-a" },
    });
    expect(queryMocks.upsertAuthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "stable-user-id" }),
    );
    expect(queryMocks.createAomiUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: undefined,
        displayName: undefined,
      }),
    );
  });

  it("does not overwrite an existing canonical profile from provider claims", async () => {
    queryMocks.findSignalOwner.mockResolvedValue("user-a");
    queryMocks.findAomiUserById.mockResolvedValue({
      id: "user-a",
      displayName: "Existing profile",
    });

    const result = await resolveVerifiedProviderIdentity({
      identity: {
        ...identity("project-a"),
        email: { value: "claimed@example.com", verified: true },
      },
      policy: globalPolicy,
      displayName: "Claimed profile",
    });

    expect(result.user).toEqual({
      id: "user-a",
      displayName: "Existing profile",
    });
    expect(queryMocks.createAomiUser).not.toHaveBeenCalled();
    expect(queryMocks.touchAomiUser).toHaveBeenCalledWith("user-a", {
      tx: true,
    });
  });

  it("keeps a globally stable subject on one canonical user across tenants", async () => {
    queryMocks.findProviderSubjectOwners.mockResolvedValue(["user-a"]);
    const result = await resolveVerifiedProviderIdentity({
      identity: identity("project-b"),
      policy: globalPolicy,
    });

    expect(result.user.id).toBe("user-a");
    expect(queryMocks.upsertAuthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", tenantId: "project-b" }),
    );
  });

  it("fails closed when verified signals point to different owners", async () => {
    queryMocks.findProviderSubjectOwners.mockResolvedValue(["user-a"]);
    queryMocks.findSignalOwner.mockImplementation(async (signal) =>
      signal.type === "wallet" ? "user-b" : null,
    );

    await expect(
      resolveVerifiedProviderIdentity({
        identity: identity("project-b"),
        policy: globalPolicy,
        recoverySignals: [
          {
            type: "wallet",
            family: "evm",
            normalizedAddress: "0x0000000000000000000000000000000000000001",
            chainScope: null,
          },
        ],
      }),
    ).rejects.toEqual(
      new IdentityConflictError(["user-a", "user-b"], "wallet"),
    );
    expect(queryMocks.createAomiUser).not.toHaveBeenCalled();
  });

  it("allows a provider policy to keep equal subjects distinct by tenant", async () => {
    const result = await resolveVerifiedProviderIdentity({
      identity: identity("project-b"),
      policy: { ...globalPolicy, subjectIsEnvironmentGlobal: false },
    });

    expect(result).toMatchObject({ created: true, user: { id: "new-user" } });
    expect(queryMocks.findProviderSubjectOwners).not.toHaveBeenCalled();
  });

  it("rejects authenticated linking when another user owns the subject", async () => {
    queryMocks.findProviderSubjectOwners.mockResolvedValue(["user-a"]);
    await expect(
      attachVerifiedProviderIdentityToUser({
        userId: "user-b",
        identity: identity("project-b"),
        policy: globalPolicy,
      }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
  });

  it("does not attach any identity when a recovery wallet belongs to another user", async () => {
    queryMocks.findProviderSubjectOwners.mockResolvedValue(["user-a"]);
    queryMocks.findSignalOwner.mockImplementation(async (signal) =>
      signal.type === "wallet" ? "user-b" : null,
    );
    const onAttached = vi.fn();

    await expect(
      attachVerifiedProviderIdentityToUser({
        userId: "user-a",
        identity: identity("project-a"),
        policy: globalPolicy,
        recoverySignals: [
          {
            type: "wallet",
            family: "evm",
            normalizedAddress: "0x0000000000000000000000000000000000000001",
            chainScope: null,
          },
        ],
        onAttached,
      }),
    ).rejects.toEqual(
      new IdentityConflictError(["user-a", "user-b"], "wallet"),
    );
    expect(queryMocks.upsertAuthIdentity).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("locks exact and global keys before querying and retries a uniqueness race", async () => {
    const race = Object.assign(new Error("unique race"), { code: "23505" });
    queryMocks.withTransaction
      .mockRejectedValueOnce(race)
      .mockImplementation(async (fn) => fn({ tx: true }));

    await expect(
      resolveVerifiedProviderIdentity({
        identity: identity("project-a"),
        policy: globalPolicy,
      }),
    ).resolves.toMatchObject({ user: { id: "new-user" } });

    expect(queryMocks.withTransaction).toHaveBeenCalledTimes(2);
    expect(queryMocks.lockIdentityResolutionKeys).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining("aomi-provider-exact"),
        expect.stringContaining("aomi-provider-subject"),
      ]),
      { tx: true },
    );
    const lockKeys = queryMocks.lockIdentityResolutionKeys.mock.calls[0]?.[0];
    expect(lockKeys).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(lockKeys.every((key: string) => !key.includes("\u0000"))).toBe(true);
    expect(
      queryMocks.lockIdentityResolutionKeys.mock.invocationCallOrder[0],
    ).toBeLessThan(queryMocks.findSignalOwner.mock.invocationCallOrder[0]!);
  });
});
