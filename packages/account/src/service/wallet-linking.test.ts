// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createWalletLinkNonce,
  verifyWalletLinkNonce,
  walletLinkMessageMatches,
} from "../src/service/wallet-linking";

const address = "0x1111111111111111111111111111111111111111";

describe("wallet link nonce", () => {
  it("is scoped to the configured auth domain", () => {
    const nonce = createWalletLinkNonce({
      userId: "user-1",
      address,
      chainId: 1,
      domain: "portal.aomi.dev",
      secret: "secret",
      now: 1_700_000_000_000,
      random: "fixed",
    });

    expect(
      verifyWalletLinkNonce({
        nonce,
        userId: "user-1",
        address,
        chainId: 1,
        domain: "portal.aomi.dev",
        secret: "secret",
        now: 1_700_000_001_000,
      }),
    ).toBe(true);
    expect(
      verifyWalletLinkNonce({
        nonce,
        userId: "user-1",
        address,
        chainId: 1,
        domain: "embedder.example.com",
        secret: "secret",
        now: 1_700_000_001_000,
      }),
    ).toBe(false);
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
