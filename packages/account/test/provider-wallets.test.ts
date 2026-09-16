// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { listParaWalletsForUser } from "../src/providers/para";
import { listPrivyWalletsForUser } from "../src/providers/privy";

const EVM = "0x1111111111111111111111111111111111111111";
const EVM2 = "0x2222222222222222222222222222222222222222";
const SOL = "5tzFkiKscXHK5ZXCGbWZPAw8u5zxvf7mP9qHb2x9t6vX";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(
  responses: Array<Response | (() => Response)>,
): typeof fetch {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("mock fetch: no more responses");
    return typeof next === "function" ? next() : next;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("listPrivyWalletsForUser", () => {
  it("returns EVM and Solana wallets owned by the verified user", async () => {
    mockFetch([
      jsonResponse({
        data: [
          {
            id: "w-evm",
            address: EVM,
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
          },
          {
            id: "w-sol",
            address: SOL,
            chain_type: "solana",
            owner_id: "did:privy:alice",
          },
        ],
        next_cursor: null,
      }),
    ]);

    const result = await listPrivyWalletsForUser({
      appId: "app",
      appSecret: "secret",
      userId: "did:privy:alice",
    });

    expect(result).toEqual([
      {
        provider: "privy",
        providerWalletId: "w-evm",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
      {
        provider: "privy",
        providerWalletId: "w-sol",
        family: "svm",
        address: SOL,
        chainScope: null,
      },
    ]);
  });

  it("filters out imported / exported / archived wallets (not custodied now)", async () => {
    mockFetch([
      jsonResponse({
        data: [
          {
            id: "w-embedded",
            address: EVM,
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
          },
          {
            id: "w-imported",
            address: EVM2,
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
            imported_at: 1700000000000,
          },
          {
            id: "w-exported",
            address: "0x3333333333333333333333333333333333333333",
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
            exported_at: 1700000000000,
          },
          {
            id: "w-archived",
            address: "0x4444444444444444444444444444444444444444",
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
            archived_at: 1700000000000,
          },
        ],
        next_cursor: null,
      }),
    ]);

    const result = await listPrivyWalletsForUser({
      appId: "app",
      appSecret: "secret",
      userId: "did:privy:alice",
    });

    expect(result.map((w) => w.providerWalletId)).toEqual(["w-embedded"]);
  });

  it("does NOT reject on owner_id mismatch (Privy owner_id is a different id space than the DID)", async () => {
    // Ownership is scoped by the `user_id` query param server-side; the
    // response `owner_id` is Privy's internal user key (e.g. "kzs88jg9..."),
    // not a `did:privy:…`, so it must not be equality-checked against the
    // verified subject. A wallet with a foreign-looking owner_id still links.
    mockFetch([
      jsonResponse({
        data: [
          {
            id: "w-internal-owner",
            address: EVM,
            chain_type: "ethereum",
            owner_id: "kzs88jg9n47oenz3zzymx44d",
          },
        ],
        next_cursor: null,
      }),
    ]);

    const result = await listPrivyWalletsForUser({
      appId: "app",
      appSecret: "secret",
      userId: "did:privy:alice",
    });

    expect(result.map((w) => w.providerWalletId)).toEqual(["w-internal-owner"]);
  });

  it("skips unsupported chain types and malformed addresses", async () => {
    mockFetch([
      jsonResponse({
        data: [
          {
            id: "w-cosmos",
            address: "cosmos1...",
            chain_type: "cosmos",
            owner_id: "did:privy:alice",
          },
          {
            id: "w-bad",
            address: "0xnothex",
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
          },
        ],
        next_cursor: null,
      }),
    ]);

    const result = await listPrivyWalletsForUser({
      appId: "app",
      appSecret: "secret",
      userId: "did:privy:alice",
    });

    expect(result).toEqual([]);
  });

  it("throws on a non-2xx response so callers skip the sync instead of revoking", async () => {
    mockFetch([jsonResponse({ error: "unauthorized" }, 401)]);

    await expect(
      listPrivyWalletsForUser({
        appId: "app",
        appSecret: "bad-secret",
        userId: "did:privy:alice",
      }),
    ).rejects.toThrow("privy wallets: list failed (401");
  });

  it("follows the cursor across pages", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (url: URL | string) => {
      calls++;
      const u = new URL(url.toString());
      const cursor = u.searchParams.get("cursor");
      if (!cursor) {
        return jsonResponse({
          data: [
            {
              id: "w1",
              address: EVM,
              chain_type: "ethereum",
              owner_id: "did:privy:alice",
            },
          ],
          next_cursor: "page2",
        });
      }
      return jsonResponse({
        data: [
          {
            id: "w2",
            address: EVM2,
            chain_type: "ethereum",
            owner_id: "did:privy:alice",
          },
        ],
        next_cursor: null,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await listPrivyWalletsForUser({
      appId: "app",
      appSecret: "secret",
      userId: "did:privy:alice",
    });

    expect(calls).toBe(2);
    expect(result.map((w) => w.providerWalletId)).toEqual(["w1", "w2"]);
  });
});

describe("listParaWalletsForUser", () => {
  it("returns embedded MPC wallets only", async () => {
    mockFetch([
      jsonResponse({
        wallets: [
          { id: "p-embedded", address: EVM, type: "EVM", scheme: "DKLS" },
          { id: "p-sol", address: SOL, type: "SOLANA", scheme: "FROST" },
        ],
        pagination: { hasMore: false },
      }),
    ]);

    const result = await listParaWalletsForUser({
      apiKey: "sk_x",
      userIdentifier: "para-user-id",
    });

    expect(result).toEqual([
      {
        provider: "para",
        providerWalletId: "p-embedded",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "p-sol",
        family: "svm",
        address: SOL,
        chainScope: null,
      },
    ]);
  });

  it("filters out wallets without a recognized embedded/MPC scheme", async () => {
    mockFetch([
      jsonResponse({
        wallets: [
          { id: "p-embedded", address: EVM, type: "EVM", scheme: "DKLS" },
          { id: "p-external", address: EVM2, type: "EVM", scheme: "EXTERNAL" },
          {
            id: "p-unknown",
            address: "0x3333333333333333333333333333333333333333",
            type: "EVM",
          },
        ],
        pagination: { hasMore: false },
      }),
    ]);

    const result = await listParaWalletsForUser({
      apiKey: "sk_x",
      userIdentifier: "para-user-id",
    });

    expect(result.map((w) => w.providerWalletId)).toEqual(["p-embedded"]);
  });

  it("throws on a non-2xx response", async () => {
    mockFetch([jsonResponse({ error: "bad key" }, 403)]);

    await expect(
      listParaWalletsForUser({ apiKey: "sk_bad", userIdentifier: "u" }),
    ).rejects.toThrow("para wallets: list failed (403");
  });
});
