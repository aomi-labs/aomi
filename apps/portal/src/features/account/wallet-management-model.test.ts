import { describe, expect, it } from "vitest";
import {
  buildUnifiedAccountWallets,
  isProviderSigningWallet,
  visibleSignInMethods,
  walletConnectionSummary,
} from "./wallet-management-model";

describe("buildUnifiedAccountWallets", () => {
  it("deduplicates connected, linked, and policy records by family and address", () => {
    const rows = buildUnifiedAccountWallets({
      accounts: [
        {
          id: "rabby",
          family: "evm",
          address: "0xABC",
          walletName: "Rabby",
          walletKind: "external",
          active: true,
        },
      ],
      linkedWallets: [
        {
          id: "wallet-1",
          family: "evm",
          address: "0xabc",
          kind: "external",
          linkedVia: "siwe",
        },
      ],
      policies: [
        {
          id: "evm:0xabc",
          chain: "evm",
          address: "0xabc",
          linkedVia: "siwe",
          desiredMode: "manual",
          authVersion: 1,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      walletName: "Rabby",
      connected: true,
      linked: true,
      active: true,
      connectedAccountId: "rabby",
      accountWalletId: "wallet-1",
    });
  });

  it("keeps wallet order stable when the active wallet changes", () => {
    const rows = buildUnifiedAccountWallets({
      accounts: [
        { id: "two", family: "svm", address: "Two", active: false },
        { id: "one", family: "evm", address: "0x1", active: true },
      ],
      linkedWallets: [
        {
          id: "three",
          family: "evm",
          address: "0x3",
          linkedVia: "siwe",
        },
      ],
      policies: [],
    });

    expect(rows.map((row) => row.address)).toEqual(["0x3", "Two", "0x1"]);

    const switched = buildUnifiedAccountWallets({
      accounts: [
        { id: "two", family: "svm", address: "Two", active: true },
        { id: "one", family: "evm", address: "0x1", active: false },
      ],
      linkedWallets: [
        {
          id: "three",
          family: "evm",
          address: "0x3",
          linkedVia: "siwe",
        },
      ],
      policies: [],
    });

    expect(switched.map((row) => row.address)).toEqual(["0x3", "Two", "0x1"]);
  });

  it("keeps a live wallet connected while the account runtime refreshes", () => {
    const rows = buildUnifiedAccountWallets({
      accounts: [],
      linkedWallets: [
        {
          id: "wallet-rabby",
          family: "evm",
          address: "0xABC",
          label: "Rabby 1",
          linkedVia: "siwe",
        },
      ],
      policies: [],
      liveConnections: [
        {
          id: "rabby-connector",
          family: "evm",
          address: "0xabc",
          walletName: "Rabby",
          chainId: 1,
          active: true,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      walletName: "Rabby",
      label: "Rabby 1",
      connected: true,
      linked: true,
      active: true,
      connectedAccountId: "rabby-connector",
      accountWalletId: "wallet-rabby",
    });
  });
});

describe("wallet management classification", () => {
  it("summarizes linked wallets that are offline on this device", () => {
    expect(
      walletConnectionSummary([
        {
          key: "evm:0x1",
          family: "evm",
          address: "0x1",
          connected: true,
          linked: true,
          active: true,
        },
        {
          key: "evm:0x2",
          family: "evm",
          address: "0x2",
          connected: false,
          linked: true,
          active: false,
        },
      ]),
    ).toBe("2 linked wallets · 1 not connected on this device");
  });

  it("keeps public wallet proofs out of provider signing controls", () => {
    expect(
      isProviderSigningWallet({
        id: "external",
        chain: "evm",
        address: "0x1",
        linkedVia: "siwe",
        desiredMode: "manual",
        authVersion: 1,
      }),
    ).toBe(false);
    expect(
      isProviderSigningWallet({
        id: "para",
        chain: "evm",
        address: "0x2",
        linkedVia: "para",
        desiredMode: "auto",
        authVersion: 1,
      }),
    ).toBe(true);
  });

  it("hides transport wallet identities but keeps user sign-in methods", () => {
    expect(
      visibleSignInMethods([
        { id: "ba", provider: "better_auth", subject: "internal" },
        { id: "wallet", provider: "siwe", subject: "0x1" },
        { id: "google", provider: "google", subject: "person" },
        { id: "email", provider: "email", subject: "person@example.com" },
      ]).map((account) => account.provider),
    ).toEqual(["google", "email"]);
  });
});
