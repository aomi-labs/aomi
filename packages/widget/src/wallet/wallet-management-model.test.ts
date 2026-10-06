import { describe, expect, it } from "vitest";
import {
  isProviderSigningWallet,
  providerEmailDisplayHint,
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

  it("hides protected transport and email identities but keeps independent sign-ins", () => {
    expect(
      visibleSignInMethods([
        { id: "ba", provider: "better_auth", subject: "internal" },
        { id: "wallet", provider: "siwe", subject: "0x1" },
        { id: "google", provider: "google", subject: "person" },
        { id: "email", provider: "email", subject: "person@example.com" },
      ]).map((account) => account.provider),
    ).toEqual(["google"]);
  });

  it("uses a provider email only as a display hint for the matching live subject", () => {
    const identity = {
      status: "connected" as const,
      isConnected: true,
      sessionProvider: "privy" as const,
      walletProviderSubject: "privy-user-1",
      primaryLabel: "cecilia@example.com",
    };
    const accounts = [
      { id: "privy-1", provider: "privy", subject: "privy-user-1" },
    ];
    expect(providerEmailDisplayHint(identity, accounts)).toBe(
      "cecilia@example.com",
    );
    expect(
      providerEmailDisplayHint(identity, [
        { id: "privy-2", provider: "privy", subject: "another-user" },
      ]),
    ).toBeUndefined();
    expect(
      providerEmailDisplayHint(
        { ...identity, primaryLabel: "Cecilia" },
        accounts,
      ),
    ).toBeUndefined();
    expect(
      providerEmailDisplayHint(
        { ...identity, status: "disconnected" },
        accounts,
      ),
    ).toBeUndefined();
  });
});
