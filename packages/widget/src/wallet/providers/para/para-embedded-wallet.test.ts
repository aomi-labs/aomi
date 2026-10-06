import { describe, expect, it } from "vitest";
import type { AomiAccount } from "../../types";
import { isParaEmbeddedAccount } from "./para-embedded-wallet";

function account(overrides: Partial<AomiAccount>): AomiAccount {
  return {
    id: "wallet",
    family: "evm",
    address: "0xaaaaaaaa",
    active: true,
    ...overrides,
  };
}

describe("isParaEmbeddedAccount", () => {
  it("detects Para accounts from ids and connector ids when the display name is generic", () => {
    expect(
      isParaEmbeddedAccount(
        account({
          id: "para-session",
          walletName: "Embedded wallet",
        }),
      ),
    ).toBe(true);

    expect(
      isParaEmbeddedAccount(
        account({
          id: "embedded-session",
          walletName: "Embedded wallet",
          connectorIds: ["para"],
        }),
      ),
    ).toBe(true);
  });

  it("does not treat unrelated embedded wallets as Para", () => {
    expect(
      isParaEmbeddedAccount(
        account({
          id: "embedded-session",
          walletName: "Embedded wallet",
        }),
      ),
    ).toBe(false);
  });
});
