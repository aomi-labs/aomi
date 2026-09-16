import { describe, expect, it, vi } from "vitest";
import { buildWalletKitActions } from "./build-wallet-kit-actions";

describe("buildWalletKitActions", () => {
  it("selects an EVM account by one of its grouped connector ids", async () => {
    const selectAccount = vi.fn(async () => undefined);
    const actions = buildWalletKitActions({
      accounts: [
        {
          id: "privy-smart-session",
          family: "evm",
          address: "0xcccccccccccccccccccccccccccccccccccccccc",
          walletName: "Privy",
          active: false,
          connectorIds: ["privy-smart-session", "privy-wallet-uuid"],
        },
      ],
      auth: { provider: "privy", status: "authenticated" } as never,
      evm: { selectAccount } as never,
      execution: { evm: {}, sponsorship: {} } as never,
      registryStore: {} as never,
      registryEvmConnected: true,
    });

    await actions.selectAccount("privy-wallet-uuid");

    expect(selectAccount).toHaveBeenCalledWith("privy-wallet-uuid");
  });
});
