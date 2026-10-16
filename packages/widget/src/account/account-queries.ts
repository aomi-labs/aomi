import type { DisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountConnections,
  AomiAccountWallet,
  AomiAgentRule,
  AomiClient,
} from "@aomi-labs/client";

/**
 * Every wallet the account owns, in the server's order (agent wallets first).
 * An account still missing its EVM or SVM agent wallet gets both created
 * here, as every chat turn would; outside a portal session that call is
 * refused and the list stays as it is.
 */
export const accountWalletsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAccountWallet[]> => ({
  resource: "account-wallets",
  fetcher: async (signal) => {
    const wallets = await client.account.wallets.listWallets({ signal });
    const agent = new Set(
      wallets.filter((w) => w.kind === "agent").map((w) => w.family),
    );
    if (agent.has("evm") && agent.has("svm")) return wallets;
    return client.account.wallets
      .createAgentWallets()
      .then(() => client.account.wallets.listWallets({ signal }))
      .catch(() => wallets);
  },
});

/** The account's lock over every agent wallet. */
export const agentRuleQuery = (
  client: AomiClient,
): DisplayQuery<AomiAgentRule> => ({
  resource: "agent-rule",
  fetcher: (signal) => client.account.wallets.agentRule({ signal }),
});

/** The portal, OAuth clients and Telegram bots that use the account. */
export const connectionsQuery = (
  client: AomiClient,
): DisplayQuery<AomiAccountConnections> => ({
  resource: "connections",
  fetcher: (signal) => client.account.connections.list({ signal }),
});
