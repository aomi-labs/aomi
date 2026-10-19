import type { DisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnections,
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

/** The portal, OAuth clients and Telegram bots that use the account. */
export const connectionsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAccountConnections> => ({
  resource: "connections",
  fetcher: (signal) => client.account.connections.list({ signal }),
});
