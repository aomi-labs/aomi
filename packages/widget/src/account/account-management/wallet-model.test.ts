import { describe, expect, it } from "vitest";
import { resolveWalletState } from "@/wallet/composer/wallet-state";
import { walletSections } from "./wallet-model";

describe("identity-owned wallet sections", () => {
  it.each(["para", "privy"])(
    "keeps %s scopes separate regardless of login order",
    (provider) => {
      const rows = resolveWalletState({
        account: { id: "account", status: "ready" },
        linked: [
          {
            id: "evm",
            family: "evm",
            address: "0x1111111111111111111111111111111111111111",
            kind: "embedded",
            provider,
            authIdentityId: "current",
          },
          {
            id: "svm",
            family: "svm",
            address: "11111111111111111111111111111111",
            kind: "embedded",
            provider,
            authIdentityId: "current",
          },
        ],
        connections: [],
        mountedProviders: [],
        selection: {},
      }).wallets;
      const identities = [
        { id: "legacy", provider, subject: "same" },
        { id: "current", provider, subject: "same" },
      ];
      for (const order of [identities, [...identities].reverse()]) {
        const { logins } = walletSections(rows, undefined, order);
        expect(
          logins.find((group) => group.identity?.id === "legacy")?.rows,
        ).toHaveLength(0);
        expect(
          logins
            .find((group) => group.identity?.id === "current")
            ?.rows.map((row) => row.linkedWalletId),
        ).toEqual(["evm", "svm"]);
      }
    },
  );

  it("does not assign wallets with unknown ownership to the first login", () => {
    const rows = resolveWalletState({
      account: { id: "account", status: "ready" },
      linked: [
        {
          id: "unknown",
          family: "evm",
          address: "0x1111111111111111111111111111111111111111",
          kind: "embedded",
          provider: "privy",
        },
      ],
      connections: [],
      mountedProviders: [],
      selection: {},
    }).wallets;
    const { logins } = walletSections(rows, undefined, [
      { id: "legacy", provider: "privy", subject: "same" },
    ]);
    expect(logins.find((group) => group.identity)?.rows).toHaveLength(0);
    expect(logins.find((group) => !group.identity)?.rows).toHaveLength(1);
  });
});
