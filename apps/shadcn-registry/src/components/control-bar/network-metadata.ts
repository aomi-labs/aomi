import { getChainInfo } from "@aomi-labs/react";

type EvmNetworkMetadata = {
  id: number;
  sourceId?: number;
  nativeCurrency?: { symbol?: string };
};

const KNOWN_L2_CHAIN_IDS = new Set([
  10, 42161, 8453, 84532, 59141, 59144, 4663, 4326,
]);

function networkLayer(
  chain: EvmNetworkMetadata,
): "L1" | "L2" | "Local" | "PoS" {
  if (chain.id === 31337) return "Local";
  if (chain.id === 137) return "PoS";
  if (chain.sourceId != null || KNOWN_L2_CHAIN_IDS.has(chain.id)) return "L2";
  return "L1";
}

export function evmNetworkDescription(chain: EvmNetworkMetadata): string {
  const symbol = chain.nativeCurrency?.symbol || getChainInfo(chain.id)?.ticker;
  const layer = networkLayer(chain);
  return symbol ? `${layer} · ${symbol}` : layer;
}
