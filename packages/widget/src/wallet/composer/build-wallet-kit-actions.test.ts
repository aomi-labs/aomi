import { describe, expect, it, vi } from "vitest";
import { buildWalletKitActions } from "./build-wallet-kit-actions";

describe("buildWalletKitActions", () => {
  it("uses an embedded runtime switcher before persisting an EVM selection", async () => {
    const switchChainAsync = vi.fn(async () => undefined);
    const selectNetwork = vi.fn(async () => undefined);
    const actions = buildWalletKitActions({
      accounts: [],
      auth: { provider: "privy", status: "authenticated" } as never,
      evm: {
        activeEvmConnection: { chainId: 1 },
        selectNetwork,
      } as never,
      execution: { evm: { switchChainAsync }, sponsorship: {} } as never,
      registryStore: {} as never,
      registryEvmConnected: true,
    });

    await actions.selectNetwork({ family: "evm", chainId: 5_042_002 });

    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 5_042_002 });
    expect(selectNetwork).toHaveBeenCalledWith(5_042_002);
    expect(switchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(
      selectNetwork.mock.invocationCallOrder[0],
    );
  });

  it("does not persist an EVM selection when its wallet switch fails", async () => {
    const selectNetwork = vi.fn(async () => undefined);
    const actions = buildWalletKitActions({
      accounts: [],
      auth: { provider: "privy", status: "authenticated" } as never,
      evm: {
        activeEvmConnection: { chainId: 1 },
        selectNetwork,
      } as never,
      execution: {
        evm: {
          switchChainAsync: vi.fn(async () =>
            Promise.reject(new Error("rejected")),
          ),
        },
        sponsorship: {},
      } as never,
      registryStore: {} as never,
      registryEvmConnected: true,
    });

    await expect(
      actions.selectNetwork({ family: "evm", chainId: 5_042_002 }),
    ).rejects.toThrow("rejected");
    expect(selectNetwork).not.toHaveBeenCalled();
  });

  it("switches a regular wallet through its active connector", async () => {
    const connector = { id: "metamask" } as never;
    const switchChainAsync = vi.fn(async () => undefined);
    const selectNetwork = vi.fn(async () => undefined);
    const actions = buildWalletKitActions({
      accounts: [],
      auth: { provider: "wagmi", status: "authenticated" } as never,
      evm: {
        activeConnector: connector,
        activeEvmConnection: { chainId: 1 },
        selectNetwork,
      } as never,
      execution: {
        evm: { activeConnector: connector, switchChainAsync },
        sponsorship: {},
      } as never,
      registryStore: {} as never,
      registryEvmConnected: true,
    });

    await actions.selectNetwork({ family: "evm", chainId: 5_042_002 });

    expect(switchChainAsync).toHaveBeenCalledWith({
      chainId: 5_042_002,
      connector,
    });
    expect(selectNetwork).toHaveBeenCalledWith(5_042_002);
  });

  it("persists an EVM selection without switching when no wallet is connected", async () => {
    const switchChainAsync = vi.fn(async () => undefined);
    const selectNetwork = vi.fn(async () => undefined);
    const actions = buildWalletKitActions({
      accounts: [],
      auth: { provider: "wagmi", status: "authenticated" } as never,
      evm: { selectNetwork } as never,
      execution: { evm: { switchChainAsync }, sponsorship: {} } as never,
      registryStore: {} as never,
      registryEvmConnected: false,
    });

    await actions.selectNetwork({ family: "evm", chainId: 5_042_002 });

    expect(switchChainAsync).not.toHaveBeenCalled();
    expect(selectNetwork).toHaveBeenCalledWith(5_042_002);
  });

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
