import { describe, expect, it } from "vitest";
import { shouldProbeWalletCapabilities } from "./safe-hooks";

const account = "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0";

describe("shouldProbeWalletCapabilities", () => {
  it("skips Rabby-branded capability probes", () => {
    expect(
      shouldProbeWalletCapabilities({
        account,
        connector: {
          id: "io.rabby",
          name: "Rabby Wallet",
          type: "injected",
          uid: "rabby-1",
        },
      }),
    ).toBe(false);
  });

  it("skips generic injected connectors when the registry resolved Rabby", () => {
    expect(
      shouldProbeWalletCapabilities({
        account,
        connector: {
          id: "injected",
          name: "Injected",
          type: "injected",
          uid: "injected-1",
        },
        stableId: "injected",
        walletName: "Rabby",
      }),
    ).toBe(false);
  });

  it("keeps probing non-Rabby connected wallets", () => {
    expect(
      shouldProbeWalletCapabilities({
        account,
        connector: {
          id: "baseAccount",
          name: "Base Account",
          type: "baseAccount",
          uid: "base-1",
        },
      }),
    ).toBe(true);
  });

  it("does not probe before an account and connector are available", () => {
    expect(shouldProbeWalletCapabilities()).toBe(false);
    expect(
      shouldProbeWalletCapabilities({
        account,
      }),
    ).toBe(false);
  });
});
