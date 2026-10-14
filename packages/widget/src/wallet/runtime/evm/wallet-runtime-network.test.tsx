import { useMemo, useState, useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegistryEvent, WalletRegistryState } from "@/wallet/registry/types";
import { createInitialState, reduce } from "@/wallet/registry/reducer";
import { useEmbeddedSessionSource } from "@/wallet/providers/sources/embedded-session-source";
import { useEvmWalletRuntime } from "./wallet-runtime";

const fixture = vi.hoisted(() => ({
  externalChain: undefined as number | undefined,
}));
vi.mock("wagmi", () => {
  const config = { chains: [{ id: 1 }, { id: 42161 }], connectors: [] };
  return {
    useWalletClient: () => ({}),
    useSwitchChain: () => ({}),
    useDisconnect: () => ({}),
    useReconnect: () => ({}),
    useConnectors: () => [],
    useConnect: () => ({}),
    useSwitchAccount: () => ({}),
    useSendTransaction: () => ({}),
    useSignTypedData: () => ({}),
    useSignMessage: () => ({}),
    useConfig: () => config,
  };
});
vi.mock("./wagmi-hooks", () => ({
  useWagmiConnections: () => [],
  useSendCallsSyncExecutor: () => undefined,
  useGetWalletClientFor: () => undefined,
  useWalletCapabilities: () => undefined,
}));
vi.mock("./brands", () => ({
  useInstalledWalletFlags: () => ({}),
  dedupeWalletOptions: (options: unknown[]) => options,
}));
vi.mock("./registry-source", () => ({
  useWagmiRegistrySource: () => undefined,
}));
vi.mock("@/wallet/registry/use-wallet-registry", () => ({
  useWalletRegistry: () => {
    const store = useMemo(() => {
      let state = createInitialState();
      state.phase = "stable";
      if (fixture.externalChain) {
        const connection = {
          key: "evm:external",
          family: "evm" as const,
          uid: "external",
          stableId: "external",
          kind: "external-evm" as const,
          address: "0x1111111111111111111111111111111111111111",
          addresses: ["0x1111111111111111111111111111111111111111"],
          chainId: fixture.externalChain,
        };
        state.connections = [connection];
        state.activeByFamily.evm = { ...connection, family: "evm" };
      }
      const listeners = new Set<() => void>();
      return {
        getSnapshot: (): WalletRegistryState => state,
        subscribe: (callback: () => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        dispatch: (event: RegistryEvent) => {
          state = reduce(state, event);
          listeners.forEach((callback) => callback());
        },
      };
    }, []);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return { store, state };
  },
}));

function WalletNetwork({ embedded = true }: { embedded?: boolean }) {
  const [selected, setSelected] = useState<number | undefined>(1);
  const runtime = useEvmWalletRuntime({
    selectedEvmChainId: selected,
    setSelectedEvmChainId: setSelected,
    storageKey: "network-test",
  });
  useEmbeddedSessionSource(runtime.registryStore, {
    up: embedded,
    providerId: "privy",
    uid: "privy-smart-session",
    stableId: "privy",
    walletName: "Privy",
    embeddedEvmAddress: embedded
      ? "0x2222222222222222222222222222222222222222"
      : null,
    chainId: selected,
  });
  return (
    <>
      <output>
        {selected}:{runtime.activeEvmConnection?.chainId}
      </output>
      <button onClick={() => void runtime.selectNetwork(42161)}>
        Arbitrum
      </button>
      <button onClick={() => void runtime.selectNetwork(1)}>Ethereum</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  fixture.externalChain = undefined;
});
describe("EVM network synchronization", () => {
  it("settles embedded preference changes without echoing the stale synthetic chain", () => {
    render(<WalletNetwork />);
    expect(screen.getByText("1:1")).toBeTruthy();
    fireEvent.click(screen.getByText("Arbitrum"));
    expect(screen.getByText("42161:42161")).toBeTruthy();
    fireEvent.click(screen.getByText("Ethereum"));
    expect(screen.getByText("1:1")).toBeTruthy();
  });
  it("still follows an independently observed external connector chain", () => {
    fixture.externalChain = 42161;
    render(<WalletNetwork embedded={false} />);
    expect(screen.getByText("42161:42161")).toBeTruthy();
  });
});
