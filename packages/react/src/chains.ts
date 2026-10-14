import {
  SUPPORTED_CHAINS as CLIENT_SUPPORTED_CHAINS,
  type ChainInfo,
} from "@aomi-labs/client";

export const getNetworkName = (
  chainId: number | string | undefined,
): string => {
  if (chainId === undefined) return "";
  const id = typeof chainId === "string" ? Number(chainId) : chainId;
  switch (id) {
    case 1:
      return "ethereum";
    case 137:
      return "polygon";
    case 42161:
      return "arbitrum";
    case 8453:
      return "base";
    case 10:
      return "optimism";
    case 11155111:
      return "sepolia";
    case 143:
      return "monad";
    case 10143:
      return "monad-testnet";
    case 4326:
      return "megaeth";
    case 5042:
      return "arc";
    case 5042002:
      return "arc-testnet";
    case 1337:
    case 31337:
      return "testnet";
    case 59141:
      return "linea-sepolia";
    case 59144:
      return "linea";
    default:
      return "testnet";
  }
};

export type { ChainInfo } from "@aomi-labs/client";

/** All chains supported by the application. Sourced from @aomi-labs/client. */
export const SUPPORTED_CHAINS: ChainInfo[] = [...CLIENT_SUPPORTED_CHAINS];

/** Look up ChainInfo by chain ID. Returns undefined for unknown chains. */
export const getChainInfo = (
  chainId: number | undefined,
): ChainInfo | undefined =>
  chainId === undefined
    ? undefined
    : SUPPORTED_CHAINS.find((c) => c.id === chainId);
