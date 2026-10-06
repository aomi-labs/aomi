// @vitest-environment node

import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { buildSiwsMessage } from "../../client/src/siws";
import { parseSiwsMessage, verifySiwsMessage } from "../src/better-auth/siws";

const NOW = Date.parse("2030-01-02T03:04:05.000Z");

describe("Better Auth SIWS protocol", () => {
  it("verifies the exact SIWS sign-in message produced by the TypeScript CLI", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const message = buildSiwsMessage({
      address,
      chainId: "solana:devnet",
      nonce: "nonce-123",
      intent: "sign-in",
      domain: "chat.aomi.dev",
      uri: "https://chat.aomi.dev",
      issuedAt: new Date(NOW),
    });
    const signature = Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    ).toString("base64");

    expect(parseSiwsMessage(message)).toEqual({
      statement: "Sign in to Aomi.",
      domain: "chat.aomi.dev",
      address,
      uri: "https://chat.aomi.dev",
      chainId: "solana:devnet",
      nonce: "nonce-123",
      issuedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(
      verifySiwsMessage({
        message,
        signature,
        walletAddress: address,
        chainId: "solana:devnet",
        intent: "sign-in",
        nonce: "nonce-123",
        domain: "chat.aomi.dev",
        uri: "https://chat.aomi.dev",
        now: NOW,
      }),
    ).toBe(true);
  });

  it("binds link intent, account, cluster, domain, nonce, and signature", () => {
    const keypair = nacl.sign.keyPair();
    const other = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const message = buildSiwsMessage({
      address,
      chainId: "solana:mainnet",
      nonce: "link-nonce",
      intent: "link",
      domain: "localhost:3000",
      uri: "http://127.0.0.1:3000",
      issuedAt: new Date(NOW),
    });
    const signature = Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    ).toString("base64");
    const verify = (overrides = {}) =>
      verifySiwsMessage({
        message,
        signature,
        walletAddress: address,
        chainId: "solana:mainnet",
        intent: "link",
        nonce: "link-nonce",
        domain: "localhost:3000",
        uri: "http://localhost:3000",
        now: NOW,
        ...overrides,
      });

    expect(verify()).toBe(true);
    expect(verify({ intent: "sign-in" })).toBe(false);
    expect(verify({ nonce: "wrong" })).toBe(false);
    expect(verify({ chainId: "solana:testnet" })).toBe(false);
    expect(verify({ domain: "evil.example" })).toBe(false);
    expect(verify({ walletAddress: bs58.encode(other.publicKey) })).toBe(false);
    expect(
      verify({
        signature: bs58.encode(
          nacl.sign.detached(
            new TextEncoder().encode(message),
            other.secretKey,
          ),
        ),
      }),
    ).toBe(false);
  });
});
