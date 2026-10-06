// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  countLoginFactors,
  claimTelegramSessionOwner,
  revokeAuthIdentity,
  updateWalletLabel,
  upsertWallet,
} from "../src/db/queries";

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
  it("resolves a Telegram session only through the same canonical owner", async () => {
    const { db, calls } = fakeDb(() => ({
      rows: [{ user_id: "canonical-user" }],
    }));

    await expect(
      claimTelegramSessionOwner({
        sessionId: "thread-1",
        telegramUserId: "12345",
        db: db as never,
      }),
    ).resolves.toBe("canonical-user");
    expect(calls[0]?.params).toEqual(["thread-1", "12345"]);
    expect(calls[0]?.sql).toContain("from auth_providers");
    expect(calls[0]?.sql).toContain("ap.provider = 'telegram'");
    expect(calls[0]?.sql).toContain("update threads");
    expect(calls[0]?.sql).toContain("t.user_id is null");
  });

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
          JSON.stringify({ display_label: "CLI wallet" }),
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
              authorization_metadata: { display_label: "CLI wallet" },
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
      db: db as never,
    });

    expect(wallet.id).toBe("7");
    expect(wallet.provider).toBe("siwe");
    expect(wallet.label).toBe("CLI wallet");
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

    expect(calls.map((call) => call.sql.replace(/\s+/g, " "))).toEqual([
      expect.stringContaining("select id from auth_providers"),
      expect.stringContaining("delete from public_keys"),
      expect.stringContaining("delete from auth_providers"),
    ]);
  });
});
