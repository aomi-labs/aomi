// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  countLoginFactors,
  buildAccountResponse,
  findAuthIdentityForUnlink,
  revokeAuthIdentity,
  updateWalletLabel,
  upsertWallet,
} from "./queries";

type QueryCall = {
  sql: string;
  params?: unknown[];
};

function fakeDb(
  handler: (call: QueryCall) => { rows: unknown[]; rowCount?: number },
) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const call = { sql, params };
        calls.push(call);
        return handler(call);
      }),
    },
  };
}

describe("canonical account queries", () => {
  it("counts independent auth providers instead of provider-owned child wallets", async () => {
    const { db, calls } = fakeDb(() => ({
      rows: [{ count: 1 }],
    }));

    await expect(countLoginFactors("user-1", db as never)).resolves.toBe(1);
    expect(calls[0]?.sql).not.toContain("public_keys");
    expect(calls[0]?.sql).not.toContain("'email'");
    expect(calls[0]?.sql).not.toContain("'siwe'");
    expect(calls[0]?.sql).not.toContain("'siws'");
    expect(calls[0]?.sql).toContain("'betterauth'");
    // Agent wallet identities (provider-managed keys) are never logins.
    expect(calls[0]?.sql).toContain("method <> 'agent'");
  });

  it("links a SIWE wallet as an owned public key with SIWE provenance", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.sql.includes("insert into auth_providers")) {
        expect(JSON.parse(String(call.params?.[7]))).not.toHaveProperty(
          "display_label",
        );
        return {
          rows: [
            {
              id: 42,
              user_id: "user-1",
              provider: "siwe",
              subject: "eip155:*:0x1111111111111111111111111111111111111111",
              method: "siwe",
              value: "eip155:*:0x1111111111111111111111111111111111111111",
              provider_metadata: {},
              created_at: 1,
              updated_at: 1,
            },
          ],
        };
      }
      if (call.sql.includes("insert into public_keys")) {
        expect(call.params).toEqual([
          "evm",
          "0x1111111111111111111111111111111111111111",
          "user-1",
          42,
          false,
          JSON.stringify({ display_label: "CLI wallet", wallet_app: "Rabby" }),
          expect.any(Number),
        ]);
        return {
          rows: [
            {
              id: 7,
              chain_type: "evm",
              address: "0x1111111111111111111111111111111111111111",
              user_id: "user-1",
              auth_provider_id: 42,
              authorization_metadata: {
                display_label: "CLI wallet",
                wallet_app: "Rabby",
              },
              created_at: 1,
              updated_at: 1,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    const wallet = await upsertWallet({
      userId: "user-1",
      family: "evm",
      address: "0x1111111111111111111111111111111111111111",
      kind: "external",
      provider: "siwe",
      linkedVia: "siwe",
      label: "CLI wallet",
      walletApp: "Rabby",
      db: db as never,
    });

    expect(wallet.id).toBe("7");
    expect(wallet.authIdentityId).toBe("42");
    expect(wallet.provider).toBe("siwe");
    expect(wallet.label).toBe("CLI wallet");
    expect(wallet.walletApp).toBe("Rabby");
    expect(calls[0]?.sql).toContain("auth_providers");
    expect(calls[1]?.sql).toContain("public_keys");
  });

  it("updates wallet labels on public_keys without mutating the provider label", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.sql.includes("update public_keys")) {
        expect(call.params).toEqual([
          7,
          "user-1",
          JSON.stringify({ display_label: "Wallet only" }),
          expect.any(Number),
        ]);
        return { rows: [], rowCount: 1 };
      }
      if (call.sql.includes("select pk.*")) {
        return {
          rows: [
            {
              id: 7,
              chain_type: "evm",
              address: "0x1111111111111111111111111111111111111111",
              user_id: "user-1",
              auth_provider_id: 42,
              wallet_provider: "siwe",
              wallet_provider_metadata: {
                display_label: "Identity label",
              },
              authorization_metadata: { display_label: "Wallet only" },
              created_at: 1,
              updated_at: 2,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    const wallet = await updateWalletLabel({
      userId: "user-1",
      walletId: "7",
      label: "Wallet only",
      db: db as never,
    });

    expect(wallet?.label).toBe("Wallet only");
    expect(calls[0]?.sql).toContain("update public_keys");
    expect(calls[0]?.sql).not.toContain("auth_providers");
  });

  it("deletes provider-owned public keys before deleting the provider", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.sql.includes("select id from auth_providers")) {
        return { rows: [{ id: 42 }] };
      }
      if (call.sql.includes("delete from public_keys")) {
        expect(call.params).toEqual([42]);
        return { rows: [], rowCount: 1 };
      }
      if (call.sql.includes("delete from auth_providers")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${call.sql}`);
    });

    await expect(
      revokeAuthIdentity({
        userId: "user-1",
        provider: "privy",
        subject: "did:privy:alice",
        db: db as never,
      }),
    ).resolves.toBe(true);

    expect(calls[0]?.sql).toContain("method <> 'agent'");
    expect(calls[0]?.sql).toContain("agent_wallet_keys");
    expect(calls.map((call) => call.sql.replace(/\s+/g, " "))).toEqual([
      expect.stringContaining("select id from auth_providers"),
      expect.stringContaining("delete from public_keys"),
      expect.stringContaining("delete from auth_providers"),
    ]);
  });
  it("does not issue deletes when the guarded identity is missing or protected", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [] }));
    await expect(
      revokeAuthIdentity({
        userId: "user-1",
        provider: "privy",
        issuerEnvironment: "privy:prod",
        tenantId: "tenant",
        subject: "agent",
        db: db as never,
      }),
    ).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("agent_wallet_keys");
  });

  it("locks only the requested user's identity before counting all owned keys", async () => {
    const { db, calls } = fakeDb((call) =>
      call.sql.includes("for update")
        ? {
            rows: [
              {
                id: 42,
                user_id: "user-1",
                provider: "privy",
                method: "privy",
                created_at: 1,
                updated_at: 1,
              },
            ],
          }
        : { rows: [{ present: true }] },
    );
    const state = await findAuthIdentityForUnlink("user-1", "42", db as never);
    expect(state?.hasWallets).toBe(true);
    expect(state?.identity.id).toBe("42");
    expect(calls[0]?.params).toEqual([42, "user-1"]);
    expect(calls[0]?.sql).toContain("for update");
    expect(calls[1]?.sql).toContain("auth_provider_id = $1");
    expect(calls[1]?.sql).not.toContain("archived");
  });

  it("preserves owning identity IDs in the account response", async () => {
    const { db } = fakeDb((call) =>
      call.sql.includes("from public_keys pk")
        ? {
            rows: [
              {
                id: 7,
                user_id: "user-1",
                auth_provider_id: 42,
                wallet_provider: "privy",
                chain_type: "evm",
                address: "0x1111111111111111111111111111111111111111",
                created_at: 1,
                updated_at: 1,
              },
            ],
          }
        : { rows: [] },
    );
    const response = await buildAccountResponse({
      user: {
        id: "user-1",
        betterAuthUserId: null,
        displayName: null,
        primaryEmail: null,
        avatarUrl: null,
        metadata: {},
        deactivatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        carrier: "widget",
        expiresAt: Date.now(),
        authMethod: "privy",
      },
      db: db as never,
    });
    expect(response.wallets[0]).toMatchObject({
      id: "7",
      authIdentityId: "42",
      provider: "privy",
    });
  });
});
