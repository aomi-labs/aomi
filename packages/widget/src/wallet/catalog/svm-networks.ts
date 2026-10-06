"use client";

import type {
  SvmCluster,
  SvmNetworkConfigInput,
  SvmNetworkOption,
} from "../types";

export const DEFAULT_SVM_CLUSTER: SvmCluster = "solana:mainnet";

export const DEFAULT_SVM_RPC_HTTP_URLS: Record<SvmCluster, string> = {
  "solana:mainnet": "https://api.mainnet-beta.solana.com",
  "solana:devnet": "https://api.devnet.solana.com",
  "solana:testnet": "https://api.testnet.solana.com",
};

export function getDefaultSvmNetworkLabel(cluster: SvmCluster): string {
  switch (cluster) {
    case "solana:mainnet":
      return "Solana";
    case "solana:testnet":
      return "Solana Testnet";
    case "solana:devnet":
    default:
      return "Solana Devnet";
  }
}

function buildLegacySvmNetwork(
  config?: SvmNetworkConfigInput,
): SvmNetworkOption {
  const cluster = config?.cluster ?? DEFAULT_SVM_CLUSTER;
  return {
    id: cluster,
    label: getDefaultSvmNetworkLabel(cluster),
    cluster,
    rpcHttpUrl: config?.rpcHttpUrl ?? DEFAULT_SVM_RPC_HTTP_URLS[cluster],
    rpcWsUrl: config?.rpcWsUrl,
    isDefault: true,
  };
}

export function normalizeSvmNetworkOptions(
  config?: SvmNetworkConfigInput,
): readonly SvmNetworkOption[] {
  const rawNetworks = config?.networks;
  if (!rawNetworks || rawNetworks.length === 0) {
    return [buildLegacySvmNetwork(config)];
  }

  return rawNetworks.map((network, index) => ({
    id: network.id,
    label: network.label || getDefaultSvmNetworkLabel(network.cluster),
    cluster: network.cluster,
    rpcHttpUrl:
      network.rpcHttpUrl ?? DEFAULT_SVM_RPC_HTTP_URLS[network.cluster],
    rpcWsUrl: network.rpcWsUrl,
    isDefault:
      network.isDefault ??
      (index === 0 && !rawNetworks.some((item) => item.isDefault)),
  }));
}

export function resolveSelectedSvmNetwork(
  networks: readonly SvmNetworkOption[],
  selectedNetworkId?: string,
): SvmNetworkOption {
  return (
    networks.find((network) => network.id === selectedNetworkId) ??
    networks.find((network) => network.isDefault) ??
    networks[0]
  );
}

export function buildDefaultSvmNetworkOptions(options?: {
  mainnetRpcHttpUrl?: string;
  mainnetRpcWsUrl?: string;
  devnetRpcHttpUrl?: string;
  devnetRpcWsUrl?: string;
  testnetRpcHttpUrl?: string;
  testnetRpcWsUrl?: string;
}): readonly SvmNetworkOption[] {
  return [
    {
      id: "solana-mainnet",
      label: "Solana",
      cluster: "solana:mainnet",
      rpcHttpUrl:
        options?.mainnetRpcHttpUrl ??
        DEFAULT_SVM_RPC_HTTP_URLS["solana:mainnet"],
      rpcWsUrl: options?.mainnetRpcWsUrl,
      isDefault: true,
    },
    {
      id: "solana-devnet",
      label: "Solana Devnet",
      cluster: "solana:devnet",
      rpcHttpUrl:
        options?.devnetRpcHttpUrl ?? DEFAULT_SVM_RPC_HTTP_URLS["solana:devnet"],
      rpcWsUrl: options?.devnetRpcWsUrl,
    },
    {
      id: "solana-testnet",
      label: "Solana Testnet",
      cluster: "solana:testnet",
      rpcHttpUrl:
        options?.testnetRpcHttpUrl ??
        DEFAULT_SVM_RPC_HTTP_URLS["solana:testnet"],
      rpcWsUrl: options?.testnetRpcWsUrl,
    },
  ];
}
