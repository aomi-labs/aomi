// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  consumeWalletLinkNonce: vi.fn(),
  getAccountResponseForBetterAuthSession: vi.fn(),
  mergeAccountWithTicket: vi.fn(),
  offerAccountMerge: vi.fn(),
  upsertVerifiedWallet: vi.fn(),
  verifyWalletLinkSignature: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@aomi-labs/account/account", () => service);
vi.mock("@aomi-labs/account", () => ({ mintAccountBearer: vi.fn() }));
vi.mock("@aomi-labs/account/better-auth", () => ({
  SIWS_CLUSTERS: ["solana:mainnet", "solana:devnet", "solana:testnet"],
  auth: { api: {} },
  readAccountAuthEnv: () => ({
    siweDomain: "portal.test",
    betterAuthUrl: "https://portal.test",
  }),
  validSolanaAddress: () => true,
  verifySiwsMessage: vi.fn(),
}));
vi.mock("@aomi-labs/account/widget-auth", () => ({}));
vi.mock("@aomi-labs/account/forward", () => ({}));
vi.mock("@/server/bff/failures", () => ({ portalFailures: {} }));
vi.mock("@/server/bff/http", () => ({}));
vi.mock("@/server/bff/principal", () => ({ PrincipalError: Error }));
vi.mock("@/server/env", () => ({}));
vi.mock("@/server/widget-auth/exchange", () => ({}));
vi.mock("./cli-session", () => ({}));
vi.mock("./session", () => ({
  sessionUserSeed: () => ({ betterAuthUserId: "ba-a" }),
}));

import { linkWallet, mergeAccount } from "./handlers";

const principal = {
  kind: "cookie",
  accountId: "acct-a",
  guest: false,
  betterAuthUserId: "ba-a",
  session: { session: {} },
} as const;
const address = "0x1111111111111111111111111111111111111111";
const wallet = { type: "wallet", family: "evm", normalizedAddress: address };
const accountGraph = {
  user: { id: "acct-a" },
  linkedAccounts: [],
  wallets: [],
};

function call(path: string, body: unknown) {
  return {
    request: new Request(`https://portal.test${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    principal,
    params: {},
  } as never;
}

describe("account merge handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getAccountResponseForBetterAuthSession.mockResolvedValue(
      accountGraph,
    );
  });

  it("turns a wallet link that hits another account into a merge offer", async () => {
    service.consumeWalletLinkNonce.mockResolvedValue(true);
    service.verifyWalletLinkSignature.mockResolvedValue(true);
    service.upsertVerifiedWallet.mockResolvedValue({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "wallet",
      owner: "acct-b",
      signal: wallet,
    });
    const other = {
      name: "0x1111…1111",
      created_at: "2026-09-12T00:00:00.000Z",
      chats: 12,
      wallets: 2,
      credits: "420",
      dropped: ["OpenAI model key"],
    };
    service.offerAccountMerge.mockResolvedValue({ ticket: "ticket-1", other });

    const response = await linkWallet(
      call("/v1/account/wallets/link", {
        family: "evm",
        address,
        chainId: 1,
        nonce: "nonce",
        message: "message",
        signature: "0xsig",
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: "account_merge_available",
      ticket: "ticket-1",
      other,
    });
    expect(JSON.stringify(body)).not.toContain("acct-b");
    expect(service.offerAccountMerge).toHaveBeenCalledWith({
      targetUserId: "acct-a",
      sourceUserId: "acct-b",
      credential: wallet,
    });
  });

  it("merges with a ticket and returns the moved counts and the account", async () => {
    service.mergeAccountWithTicket.mockResolvedValue({
      status: "merged",
      moved: { chats: 12, wallets: 2 },
    });

    const response = await mergeAccount(
      call("/v1/account/merge", { ticket: "ticket-1" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moved: { chats: 12, wallets: 2 },
      account: accountGraph,
    });
    expect(service.mergeAccountWithTicket).toHaveBeenCalledWith({
      ticket: "ticket-1",
      targetUserId: "acct-a",
    });
  });

  it("refuses a used or foreign ticket", async () => {
    service.mergeAccountWithTicket.mockResolvedValue({
      status: "invalid_ticket",
    });

    const response = await mergeAccount(
      call("/v1/account/merge", { ticket: "ticket-1" }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "merge_ticket_invalid" });
  });
});
