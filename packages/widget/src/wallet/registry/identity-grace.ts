import type { WalletSource } from "../types";

export type GracefulEvmIdentity = {
  address?: string;
  chainId?: number;
  connectorId?: string;
  walletName?: string;
  walletSource?: WalletSource;
};

export type GracefulEvmIdentityResult = {
  identity: GracefulEvmIdentity;
  disconnectedAt: number | null;
  usingCachedIdentity: boolean;
};

export function resolveGracefulEvmIdentity({
  current,
  previous,
  selectedChainId,
  disconnectedAt,
  now,
  graceMs,
  explicitDisconnect,
}: {
  current: GracefulEvmIdentity;
  previous: GracefulEvmIdentity | null;
  selectedChainId?: number;
  disconnectedAt: number | null;
  now: number;
  graceMs: number;
  explicitDisconnect: boolean;
}): GracefulEvmIdentityResult {
  if (current.address) {
    return {
      identity: current,
      disconnectedAt: null,
      usingCachedIdentity: false,
    };
  }

  if (!previous?.address || explicitDisconnect) {
    return {
      identity: current,
      disconnectedAt: null,
      usingCachedIdentity: false,
    };
  }

  const startedAt = disconnectedAt ?? now;
  if (now - startedAt > graceMs) {
    // Keep the original disconnect timestamp: resetting it to null here
    // would let the very next render restart the grace window (previous is
    // still cached), making the identity oscillate cached → empty → cached
    // for as long as the wallet stays disconnected. Only a live reconnect
    // (the `current.address` branch above) clears the timestamp.
    return {
      identity: current,
      disconnectedAt: startedAt,
      usingCachedIdentity: false,
    };
  }

  return {
    identity: {
      ...previous,
      chainId: selectedChainId ?? current.chainId ?? previous.chainId,
    },
    disconnectedAt: startedAt,
    usingCachedIdentity: true,
  };
}
