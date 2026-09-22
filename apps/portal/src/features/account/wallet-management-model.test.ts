import { describe, expect, it } from "vitest";
import {
  isProviderSigningWallet,
  visibleSignInMethods,
  walletConnectionSummary,
} from "../../../../shadcn-registry/src/components/account-shell/features/account/wallet-management-model";

describe("wallet management classification", () => {
  it("summarizes linked wallets that are offline on this device", () => {
    expect(
      walletConnectionSummary([
        {
          key: "evm:0x1",
          family: "evm",
          address: "0x1",
          kind: "external",
          state: "ready",
          connected: true,
          linked: true,
          operating: true,
          actions: [],
        },
        {
          key: "evm:0x2",
          family: "evm",
          address: "0x2",
          kind: "external",
          state: "offline",
          reason: "disconnected",
          connected: false,
          linked: true,
          operating: false,
          actions: [],
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
