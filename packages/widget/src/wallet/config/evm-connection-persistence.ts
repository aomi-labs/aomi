import type { EvmWalletsConfig } from "./types";

/**
 * Account authentication and external-wallet connection state are independent:
 * a durable Aomi session must not make the browser wallet reload-scoped.
 */
export function resolveEvmConnectionPersistence(
  wallets: EvmWalletsConfig | undefined,
): boolean {
  return wallets?.persistConnections !== false;
}
