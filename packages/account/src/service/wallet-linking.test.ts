// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  consumeWalletLinkNonce,
  issueWalletLinkNonce,
  walletLinkMessageMatches,
} from "./wallet-linking";

const address = "0x1111111111111111111111111111111111111111";

const verifications = vi.hoisted(() => new Map<string, string>());
vi.mock("../db/queries", () => ({
  storeVerification: async (input: { identifier: string; value: string }) => {
    verifications.set(input.identifier, input.value);
  },
  takeVerification: async (identifier: string) => {
    const value = verifications.get(identifier) ?? null;
    verifications.delete(identifier);
    return value;
  },
}));

describe("wallet link nonce", () => {
  it("is single use and bound to the account, address and chain", async () => {
    const target = {
      userId: "user-1",
      family: "evm" as const,
      address,
      chainId: 1,
    };
    const nonce = await issueWalletLinkNonce(target);
    expect(
      await consumeWalletLinkNonce({ ...target, userId: "user-2", nonce }),
    ).toBe(false);

    const again = await issueWalletLinkNonce(target);
    expect(
      await consumeWalletLinkNonce({
        ...target,
        address: address.toUpperCase().replace("0X", "0x"),
        nonce: again,
      }),
    ).toBe(true);
    expect(await consumeWalletLinkNonce({ ...target, nonce: again })).toBe(
      false,
    );
  });

  it("requires the wallet-link message domain to match the auth domain", () => {
    const message = `portal.aomi.dev wants to link this wallet to your Aomi account:
${address}

Only sign this message if you want this wallet attached to the current Aomi account.

URI: https://portal.aomi.dev
Version: 1
Chain ID: 1
Nonce: nonce
Issued At: 2026-06-29T10:00:00.000Z`;

    expect(
      walletLinkMessageMatches({
        message,
        address,
        chainId: 1,
        nonce: "nonce",
        domain: "portal.aomi.dev",
      }),
    ).toBe(true);
    expect(
      walletLinkMessageMatches({
        message,
        address,
        chainId: 1,
        nonce: "nonce",
        domain: "embedder.example.com",
      }),
    ).toBe(false);
  });

  it("accepts standard SIWE wording for a wallet-link nonce", () => {
    const message = `portal.aomi.dev wants you to sign in with your Ethereum account:
${address}

Sign in to Aomi.

URI: https://portal.aomi.dev
Version: 1
Chain ID: 1
Nonce: nonce
Issued At: 2026-06-29T10:00:00.000Z`;

    expect(
      walletLinkMessageMatches({
        message,
        address,
        chainId: 1,
        nonce: "nonce",
        domain: "portal.aomi.dev",
      }),
    ).toBe(true);
  });

  it("does not accept wallet-link messages that only include expected fields as substrings", () => {
    const message = `portal.aomi.dev.evil.example wants to link this wallet to your Aomi account:
0x2222222222222222222222222222222222222222

Only sign this message if you want this wallet attached to the current Aomi account.

URI: https://portal.aomi.dev
Version: 1
Chain ID: 11
Nonce: nonce-and-more
Issued At: 2026-06-29T10:00:00.000Z

portal.aomi.dev ${address} Chain ID: 1 Nonce: nonce`;

    expect(
      walletLinkMessageMatches({
        message,
        address,
        chainId: 1,
        nonce: "nonce",
        domain: "portal.aomi.dev",
      }),
    ).toBe(false);
  });
});
