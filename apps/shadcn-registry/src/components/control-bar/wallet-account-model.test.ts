import { describe, expect, it } from "vitest";
import { providerBackedAccountProvider } from "./wallet-account-model";

describe("providerBackedAccountProvider", () => {
  it("treats custom embedded and smart-account wallets as provider-backed", () => {
    expect(
      providerBackedAccountProvider({
        provider: "custom",
        kind: "embedded",
      }),
    ).toBe("custom");
    expect(
      providerBackedAccountProvider({
        provider: "custom",
        kind: "smart_account",
      }),
    ).toBe("custom");
  });

  it("keeps external provider-tagged wallets standalone", () => {
    expect(
      providerBackedAccountProvider({
        provider: "custom",
        kind: "external",
      }),
    ).toBeNull();
  });

  it("does not treat SIWE verification as a provider-backed account", () => {
    expect(
      providerBackedAccountProvider({
        provider: "siwe",
        linkedVia: "siwe",
        source: "live",
      }),
    ).toBeNull();
  });

  it("groups explicit live provider rows when no stored kind is available yet", () => {
    expect(
      providerBackedAccountProvider({
        provider: "custom",
        source: "live",
      }),
    ).toBe("custom");
  });
});
