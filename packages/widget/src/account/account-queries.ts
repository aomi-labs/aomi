import type { DisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnections,
  AomiAccountWallet,
  AomiAgentWallets,
  AomiClient,
} from "@aomi-labs/client";

/**
 * The agent wallets the user manages, archived ones included, and pause-all.
 * Kept under the `account-wallets` resource with every wallet list.
 */
export const agentWalletsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAgentWallets> => ({
  resource: "account-wallets",
  parameters: ["agent"],
  fetcher: (signal) => client.account.wallets.agentWallets({ signal }),
});

/** Every wallet the account has, one entry per address. */
export const accountWalletsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAccountWallet[]> => ({
  resource: "account-wallets",
  parameters: ["all"],
  fetcher: (signal) => client.account.wallets.listWallets({ signal }),
});

/** The portal, OAuth clients and Telegram bots that use the account. */
export const connectionsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAccountConnections> => ({
  resource: "connections",
  fetcher: (signal) => client.account.connections.list({ signal }),
});
