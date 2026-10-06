"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  useSafeConnectors,
  useSafeRawWagmiConnections,
  useSafeWagmiConfig,
} from "./safe-hooks";
import type { WalletRegistryStore } from "../../registry/store";
import { useEvmProviderBrands } from "./brands";

export function useWagmiRegistrySource(store: WalletRegistryStore): void {
  const connections = useSafeRawWagmiConnections();
  const connectors = useSafeConnectors();
  const wagmiConfig = useSafeWagmiConfig();
  const brandInputs = useMemo(
    () =>
      connections.flatMap((connection) =>
        connection.accounts.map((address) => ({
          connectorId: connection.connectorUid,
          address,
        })),
      ),
    [connections],
  );
  const brands = useEvmProviderBrands(brandInputs, connectors);
  const connectorKey = useMemo(
    () =>
      connectors
        .map((connector) => `${connector.uid}:${connector.id}`)
        .sort()
        .join("|"),
    [connectors],
  );
  const chainKey = useMemo(
    () => wagmiConfig.chains.map((chain) => chain.id).join("|"),
    [wagmiConfig.chains],
  );
  const previousConfigKeyRef = useRef<string | null>(null);
  const previousConnectionsKeyRef = useRef<string | null>(null);
  const previousBrandsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const mapped = connections.flatMap((connection) =>
      connection.accounts.map((address) => ({
        family: "evm" as const,
        uid: connection.connectorUid,
        stableId: connection.connectorId,
        address,
        addresses: [...connection.accounts],
        chainId: connection.chainId,
        walletName: brands[connection.connectorUid] ?? connection.connectorName,
      })),
    );
    const key = JSON.stringify(
      mapped
        .map((connection) => ({
          uid: connection.uid,
          stableId: connection.stableId,
          address: connection.address.toLowerCase(),
          addresses: connection.addresses.map((address) =>
            address.toLowerCase(),
          ),
          chainId: connection.chainId ?? null,
          walletName: connection.walletName ?? null,
        }))
        .sort((left, right) =>
          `${left.uid}:${left.address}`.localeCompare(
            `${right.uid}:${right.address}`,
          ),
        ),
    );
    if (previousConnectionsKeyRef.current === key) return;
    previousConnectionsKeyRef.current = key;
    store.dispatch({
      type: "wagmi/connections-changed",
      connections: mapped,
      now: Date.now(),
    });
  }, [brands, connections, store]);

  useEffect(() => {
    const key = `${connectorKey}::${chainKey}`;
    if (previousConfigKeyRef.current === null) {
      previousConfigKeyRef.current = key;
      return;
    }
    if (previousConfigKeyRef.current === key) return;
    previousConfigKeyRef.current = key;
    store.dispatch({ type: "wagmi/config-rebuilt", now: Date.now() });
  }, [chainKey, connectorKey, store]);

  useEffect(() => {
    const key = JSON.stringify(
      Object.entries(brands).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    if (previousBrandsKeyRef.current === key) return;
    previousBrandsKeyRef.current = key;
    store.dispatch({ type: "wagmi/brands-changed", brands });
  }, [brands, store]);
}
