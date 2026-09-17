import { useMemo } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chain } from "viem";
import { ExtUserProvider } from "@aomi-labs/react";
import type { AomiWalletKit } from "@/lib/wallet-kit";
import { AomiWalletKitContextProvider } from "@/lib/wallet-kit";
import type { SvmNetworkOption } from "@/lib/wallet-kit/types";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "@/lib/wallet-kit/network-preferences";
import { NetworkSelect } from "./network-select";
import { ConnectButton } from "./connect-button";

const evmChains = [
  {
    id: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://base.example"] } },
  },
] as const;

const evmChainsMulti = [
  ...evmChains,
  {
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://eth.example"] } },
  },
] as const;

const evmChainsWithRobinhood = [
  ...evmChains,
  {
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
    },
  },
] as const;

const evmChainsWithTestnet = [
  ...evmChains,
  {
    id: 84532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://base-sepolia.example"] } },
    testnet: true,
  },
] as const;

const solanaNetworks = [
  {
    id: "solana-devnet",
    label: "Solana Devnet",
    cluster: "solana:devnet",
    rpcHttpUrl: "https://api.devnet.solana.com",
    isDefault: true,
  },
  {
    id: "solana-mainnet",
    label: "Solana",
    cluster: "solana:mainnet",
    rpcHttpUrl: "https://api.mainnet-beta.solana.com",
  },
] as const;

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

function createHarnessAdapter(options?: {
  connected?: boolean;
  address?: string;
  svmAddress?: string;
  chainId?: number;
  solanaCluster?: SvmNetworkOption["cluster"];
  solanaReconnect?: boolean;
  evmChains?: readonly Chain[];
  solanaNetworks?: readonly SvmNetworkOption[];
  onSelectNetwork?: (target: unknown) => void;
}): AomiWalletKit {
  const harnessEvmChains = options?.evmChains ?? evmChains;
  const harnessSolanaNetworks = options?.solanaNetworks ?? solanaNetworks;
  return {
    identity: {
      status: options?.connected ? "connected" : "disconnected",
      isConnected: Boolean(options?.connected),
      primaryLabel: options?.connected ? "Wallet" : "Connect Account",
      address: options?.address,
      chainId: options?.chainId ?? 8453,
      svmAddress: options?.svmAddress,
      svmCluster: options?.solanaCluster ?? "solana:devnet",
    },
    isReady: true,
    isSwitchingChain: false,
    canConnect: true,
    canOpenAccountUI: Boolean(options?.connected),
    canDisconnect: false,
    accounts: [],
    selectAccount: vi.fn(async () => undefined),
    supportedChains: harnessEvmChains,
    supportedNetworks: {
      evm: harnessEvmChains,
      solana: harnessSolanaNetworks,
    },
    solanaNetworkSwitchRequiresReconnect: options?.solanaReconnect,
    connect: async () => undefined,
    openAccountUI: async () => undefined,
    selectNetwork: async (target) => {
      options?.onSelectNetwork?.(target);
    },
  };
}

function Harness({
  adapter,
  onConnect,
  onOpenAccountUI,
}: {
  adapter?: AomiWalletKit;
  onConnect?: () => void;
  onOpenAccountUI?: () => void;
}) {
  const preferences = useAomiWalletNetworkPreferences();

  const value = useMemo<AomiWalletKit>(() => {
    const baseAdapter =
      adapter ??
      createHarnessAdapter({
        onSelectNetwork: (target) => preferences.selectTarget(target as never),
      });

    return {
      ...baseAdapter,
      connect: async () => {
        onConnect?.();
      },
      openAccountUI: async () => {
        onOpenAccountUI?.();
      },
      selectNetwork: async (target) => {
        if (baseAdapter.selectNetwork) {
          await baseAdapter.selectNetwork(target);
        } else {
          preferences.selectTarget(target);
        }
      },
    };
  }, [adapter, onConnect, onOpenAccountUI, preferences]);

  return (
    <AomiWalletKitContextProvider value={value}>
      <NetworkSelect />
      <ConnectButton />
    </AomiWalletKitContextProvider>
  );
}

describe("NetworkSelect", () => {
  it("selects Robinhood Chain through the EVM wallet runtime", async () => {
    const selectNetwork = vi.fn();
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChainsWithRobinhood}
          solanaNetworks={[]}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              evmChains: evmChainsWithRobinhood,
              solanaNetworks: [],
              onSelectNetwork: selectNetwork,
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Robinhood Chain/i }));

    await waitFor(() => {
      expect(selectNetwork).toHaveBeenCalledWith({
        family: "evm",
        chainId: 4663,
      });
    });
  });

  it("labels Solana mainnet as Solana in the closed trigger", () => {
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              svmAddress: "So11111111111111111111111111111111111111112",
              solanaCluster: "solana:mainnet",
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger.textContent).toMatch(/Solana/);
    expect(trigger.textContent).not.toMatch(/Mainnet/);
  });

  it("selects a Solana network from the unified list when both families are connected", async () => {
    const selectNetwork = vi.fn();
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              svmAddress: "So11111111111111111111111111111111111111112",
              onSelectNetwork: selectNetwork,
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    // Both families connected -> EVM + Solana groups render together, no tab.
    expect(screen.getByRole("option", { name: /Base/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /^Solana$/i }));

    await waitFor(() => {
      expect(selectNetwork).toHaveBeenCalledWith({
        family: "svm",
        networkId: "solana-mainnet",
      });
    });
  });

  it("shows the connected Solana cluster instead of a stale preference", () => {
    globalThis.localStorage?.setItem(
      "aomi.wallet-preferences.default",
      JSON.stringify({ selectedSolanaNetworkId: "solana-mainnet" }),
    );

    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              svmAddress: "So11111111111111111111111111111111111111112",
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    expect(screen.getByRole("combobox").textContent).toMatch(/Base.*Devnet/);
  });

  it("confirms destructive Para-style Solana network switches", async () => {
    const selectNetwork = vi.fn();
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              svmAddress: "So11111111111111111111111111111111111111112",
              solanaReconnect: true,
              onSelectNetwork: selectNetwork,
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    // Solana-only connection -> no EVM rows, no family tab.
    expect(screen.queryByRole("option", { name: /Base/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^Solana$/i }));

    expect(
      screen.getByText(/needs to reconnect to change clusters/i),
    ).toBeTruthy();
    expect(selectNetwork).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch network" }));

    await waitFor(() => {
      expect(selectNetwork).toHaveBeenCalledWith({
        family: "svm",
        networkId: "solana-mainnet",
      });
    });
  });

  it("shows Solana networks when only an EVM wallet is connected", async () => {
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChainsMulti}
          solanaNetworks={solanaNetworks}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              evmChains: evmChainsMulti,
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /Base/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ethereum/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^Solana$/i })).toBeTruthy();
    expect(screen.queryByText("Networks")).toBeNull();
    expect(screen.queryByText(/EVM network/i)).toBeNull();
    expect(screen.getByText("L1 · ETH")).toBeTruthy();
    expect(screen.getByText("L2 · ETH")).toBeTruthy();
    expect(screen.getByText("Devnet · SOL")).toBeTruthy();
  });

  it("folds testnets behind a toggle and reveals them on demand", async () => {
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChainsWithTestnet}
          solanaNetworks={[]}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              chainId: 8453,
              evmChains: evmChainsWithTestnet,
              solanaNetworks: [],
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    // Testnet hidden by default; the toggle advertises how many are folded.
    expect(screen.queryByRole("option", { name: /Base Sepolia/i })).toBeNull();
    const toggle = screen.getByRole("button", { name: /show testnets/i });
    expect(toggle.textContent).toMatch(/1 hidden/i);

    fireEvent.click(toggle);
    expect(screen.getByRole("option", { name: /Base Sepolia/i })).toBeTruthy();
  });

  it("keeps testnets visible when the active network is a testnet", async () => {
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChainsWithTestnet}
          solanaNetworks={[]}
        >
          <Harness
            adapter={createHarnessAdapter({
              connected: true,
              address: "0xda6f0000000000000000000000000000000000f0",
              chainId: 84532,
              evmChains: evmChainsWithTestnet,
              solanaNetworks: [],
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    // On a testnet -> its row must stay visible, and the toggle is suppressed
    // (you can't hide the network you're currently on).
    expect(screen.getByRole("option", { name: /Base Sepolia/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /testnets/i })).toBeNull();
  });

  it("connects without a family selection", async () => {
    const onConnect = vi.fn();
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness onConnect={onConnect} />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalled();
    });
  });
});
