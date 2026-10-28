import type { DisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnections,
  AomiAccountWallet,
  AomiAgentWallets,
  AccountTransport,
} from "@aomi-labs/client";

/**
 * The agent wallets the user manages, archived ones included, and pause-all.
 * Kept under the `account-wallets` resource with every wallet list.
 */
export const agentWalletsQuery = (aomi: {
  account: AccountTransport;
}): DisplayQuery<AomiAgentWallets> => ({
  resource: "account-wallets",
  parameters: ["agent"],
  fetcher: (signal) => aomi.account.wallets.agentWallets({ signal }),
});

/** Every wallet the account has, one entry per address. */
export const accountWalletsQuery = (aomi: {
  account: AccountTransport;
}): DisplayQuery<AomiAccountWallet[]> => ({
  resource: "account-wallets",
  parameters: ["all"],
  fetcher: (signal) => aomi.account.wallets.listWallets({ signal }),
});

/** The portal, OAuth clients and Telegram bots that use the account. */
export const connectionsQuery = (aomi: {
  account: AccountTransport;
}): DisplayQuery<AomiAccountConnections> => ({
  resource: "connections",
  fetcher: (signal) => aomi.account.connections.list({ signal }),
});
