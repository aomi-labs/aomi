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
import type { AomiWalletKit } from "@/wallet/types";
import { AomiWalletKitContextProvider } from "@/wallet/context";
import type { SvmNetworkOption } from "@/wallet/types";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "@/wallet/network-preferences";
import { NetworkSelect } from "./network-select";
import { ConnectButton } from "@/wallet/connect-button";

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
    wallets: [],
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
  function renderSelect(options?: {
    evmChains?: readonly Chain[];
    solanaNetworks?: readonly SvmNetworkOption[];
  }) {
    const chains = options?.evmChains ?? evmChainsMulti;
    const solana = options?.solanaNetworks ?? solanaNetworks;
    const selectNetwork = vi.fn();
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={chains}
          solanaNetworks={solana}
        >
          <Harness
            adapter={createHarnessAdapter({
              evmChains: chains,
              solanaNetworks: solana,
              onSelectNetwork: selectNetwork,
            })}
          />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );
    return { selectNetwork };
  }

  it("presents every supported network without offering a switch", () => {
    const { selectNetwork } = renderSelect({
      evmChains: evmChainsWithRobinhood,
    });

    const trigger = screen.getByRole("button", { name: "Supported networks" });
    expect(trigger).toHaveTextContent("All networks");
    fireEvent.click(trigger);

    const list = screen.getByRole("list", { name: "Supported networks" });
    expect(list).toHaveTextContent("Base");
    expect(list).toHaveTextContent("Robinhood Chain");
    expect(list).toHaveTextContent("Solana");
    expect(screen.getByText("Every network, no switching")).toBeTruthy();
    expect(screen.queryByRole("option")).toBeNull();

    fireEvent.click(screen.getByText("Robinhood Chain"));
    expect(selectNetwork).not.toHaveBeenCalled();
  });

  it("always ends the logo stack on Solana", () => {
    renderSelect({
      evmChains: [
        ...evmChainsWithRobinhood,
        {
          id: 42161,
          name: "Arbitrum One",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://arb.example"] } },
        },
        {
          id: 10,
          name: "OP Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://op.example"] } },
        },
      ],
    });

    const stack = [
      ...screen
        .getByRole("button", { name: "Supported networks" })
        .querySelectorAll("[data-network]"),
    ].map((node) => node.getAttribute("data-network"));
    expect(stack).toHaveLength(4);
    expect(stack[3]).toBe("solana:solana-mainnet");
  });

  it("folds testnets into a count instead of listing them", () => {
    renderSelect({ evmChains: evmChainsWithTestnet });

    fireEvent.click(screen.getByRole("button", { name: "Supported networks" }));

    const list = screen.getByRole("list", { name: "Supported networks" });
    expect(list).not.toHaveTextContent("Base Sepolia");
    expect(list).not.toHaveTextContent("Solana Devnet");
    expect(screen.getByText(/Plus 2 testnets/)).toBeTruthy();
  });

  it("opens on mouse hover", async () => {
    renderSelect();

    fireEvent.pointerEnter(
      screen.getByRole("button", { name: "Supported networks" }),
      { pointerType: "mouse" },
    );

    expect(
      await screen.findByRole("list", { name: "Supported networks" }),
    ).toBeTruthy();
  });

  it("hides itself when only one network is supported", () => {
    renderSelect({ evmChains: evmChains, solanaNetworks: [] });

    expect(
      screen.queryByRole("button", { name: "Supported networks" }),
    ).toBeNull();
  });

  it("opens the wallet picker without a family selection", async () => {
    render(
      <ExtUserProvider>
        <AomiWalletNetworkPreferencesProvider
          evmChains={evmChains}
          solanaNetworks={solanaNetworks}
        >
          <Harness />
        </AomiWalletNetworkPreferencesProvider>
      </ExtUserProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(
      await screen.findByRole("dialog", { name: "Sign in to Aomi" }),
    ).toBeTruthy();
  });
});
