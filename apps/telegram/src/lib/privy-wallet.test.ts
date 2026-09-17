import { describe, expect, it } from "vitest";
import type { User } from "@privy-io/react-auth";

import { embeddedWallet } from "./privy-wallet";

function userWith(accounts: unknown[]): User {
  return { linkedAccounts: accounts } as unknown as User;
}

const embedded = {
  type: "wallet",
  chainType: "ethereum",
  walletClientType: "privy",
  address: "0x1111111111111111111111111111111111111111",
  id: "wallet-1",
  delegated: false,
  imported: false,
};

describe("embeddedWallet", () => {
  it("returns null without a user", () => {
    expect(embeddedWallet(null)).toBeNull();
  });

  it("reads address, id and delegation off the linked account", () => {
    expect(embeddedWallet(userWith([embedded]))).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      id: "wallet-1",
      delegated: false,
    });
  });

  it("reports delegation once Privy sets the flag", () => {
    const wallet = embeddedWallet(
      userWith([{ ...embedded, delegated: true, id: "wallet-1" }]),
    );
    expect(wallet?.delegated).toBe(true);
  });

  it("treats a missing wallet id as null rather than undefined", () => {
    // Privy only assigns the server wallet id once the wallet is delegated.
    const wallet = embeddedWallet(
      userWith([{ ...embedded, id: undefined }]),
    );
    expect(wallet?.id).toBeNull();
  });

  it("accepts privy-v2 embedded wallets", () => {
    const wallet = embeddedWallet(
      userWith([{ ...embedded, walletClientType: "privy-v2" }]),
    );
    expect(wallet?.address).toBe(embedded.address);
  });

  it("ignores external wallets, other chains and imported keys", () => {
    for (const account of [
      { ...embedded, walletClientType: "metamask" },
      { ...embedded, chainType: "solana" },
      { ...embedded, imported: true },
      { ...embedded, type: "email" },
    ]) {
      expect(embeddedWallet(userWith([account]))).toBeNull();
    }
  });

  it("finds the embedded wallet among unrelated linked accounts", () => {
    const wallet = embeddedWallet(
      userWith([
        { type: "email", address: "a@b.com" },
        { ...embedded, walletClientType: "metamask" },
        embedded,
      ]),
    );
    expect(wallet?.address).toBe(embedded.address);
  });
});
