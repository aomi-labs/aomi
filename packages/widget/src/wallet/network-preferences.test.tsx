import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
} from "./network-preferences";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const evmChains = [
  {
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://eth.example"] } },
  },
  {
    id: 8453,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://base.example"] } },
  },
] as const;

const solanaNetworks = [
  {
    id: "solana-mainnet",
    label: "Mainnet",
    cluster: "solana:mainnet",
    rpcHttpUrl: "https://m.example",
    isDefault: true,
  },
  {
    id: "solana-devnet",
    label: "Devnet",
    cluster: "solana:devnet",
    rpcHttpUrl: "https://d.example",
  },
] as const;

function Harness({
  onReady,
}: {
  onReady: (v: ReturnType<typeof useAomiWalletNetworkPreferences>) => void;
}) {
  const value = useAomiWalletNetworkPreferences();
  onReady(value);
  return null;
}

describe("network preferences persistence", () => {
  it("persists chain + cluster selections and restores them on remount", () => {
    let api!: ReturnType<typeof useAomiWalletNetworkPreferences>;
    const { unmount } = render(
      <AomiWalletNetworkPreferencesProvider
        storageKey="test"
        evmChains={evmChains}
        solanaNetworks={solanaNetworks}
      >
        <Harness onReady={(v) => (api = v)} />
      </AomiWalletNetworkPreferencesProvider>,
    );
    act(() => {
      api.setSelectedEvmChainId(8453);
      api.setSelectedSolanaNetworkId("solana-devnet");
    });
    unmount();

    let restored!: ReturnType<typeof useAomiWalletNetworkPreferences>;
    render(
      <AomiWalletNetworkPreferencesProvider
        storageKey="test"
        evmChains={evmChains}
        solanaNetworks={solanaNetworks}
      >
        <Harness onReady={(v) => (restored = v)} />
      </AomiWalletNetworkPreferencesProvider>,
    );
    expect(restored.selectedEvmChainId).toBe(8453);
    expect(restored.selectedSolanaNetworkId).toBe("solana-devnet");
  });

  it("does not restore or persist preferences when storage is disabled", () => {
    globalThis.localStorage?.setItem(
      "aomi.wallet-preferences.test",
      JSON.stringify({ selectedEvmChainId: 8453 }),
    );

    let api!: ReturnType<typeof useAomiWalletNetworkPreferences>;
    render(
      <AomiWalletNetworkPreferencesProvider
        storageKey={null}
        evmChains={evmChains}
        solanaNetworks={solanaNetworks}
      >
        <Harness onReady={(value) => (api = value)} />
      </AomiWalletNetworkPreferencesProvider>,
    );

    expect(api.selectedEvmChainId).toBe(1);
    act(() => api.setSelectedEvmChainId(8453));
    expect(globalThis.localStorage?.length).toBe(1);
  });
});
