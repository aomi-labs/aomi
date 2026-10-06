import { describe, expect, it } from "vitest";
import {
  buildPrivyClientConfig,
  privyLoginMethodsToOptions,
  toPrivyLoginMethods,
} from "./privy-auth";

describe("privyLoginMethodsToOptions", () => {
  it("collapses multiple Privy methods into one provider row", () => {
    expect(privyLoginMethodsToOptions(["email", "google", "wallet"])).toEqual([
      expect.objectContaining({
        id: "privy",
        label: "Email, wallet, or social",
        kind: "social",
        status: "available",
      }),
    ]);
  });

  it("keeps the existing Google-only label", () => {
    expect(privyLoginMethodsToOptions(["google"])[0]?.label).toBe(
      "Email or Google",
    );
  });
});

describe("toPrivyLoginMethods", () => {
  it("maps generic Aomi auth methods to Privy login method names", () => {
    expect(toPrivyLoginMethods(["email", "google", "x", "phone"])).toEqual([
      "email",
      "google",
      "twitter",
      "sms",
    ]);
  });

  it("returns undefined when no methods are configured", () => {
    expect(toPrivyLoginMethods(undefined)).toBeUndefined();
  });
});

describe("buildPrivyClientConfig", () => {
  it("leaves standalone WalletConnect behavior intact and disables the redundant additive client", () => {
    const standalone = buildPrivyClientConfig({});
    expect(standalone.appearance?.walletList).toContain("wallet_connect");
    expect(standalone.externalWallets?.walletConnect).toBeUndefined();
    const additive = buildPrivyClientConfig({ walletConnectEnabled: false });
    expect(additive.externalWallets?.walletConnect).toEqual({ enabled: false });
    expect(additive.appearance?.walletList).not.toContain("wallet_connect");
    expect(additive.appearance?.walletList).toContain("metamask");
  });
  it("creates both Ethereum and Solana embedded wallets for all users", () => {
    expect(buildPrivyClientConfig({}).embeddedWallets).toMatchObject({
      ethereum: { createOnLogin: "all-users" },
      solana: { createOnLogin: "all-users" },
    });
  });
});
