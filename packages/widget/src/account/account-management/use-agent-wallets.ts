"use client";

import { useCallback } from "react";
import { useAomiWalletKit } from "@/wallet/context";
import { useDisplayQuery } from "@aomi-labs/react";
import type {
  AomiAccountWallet,
  AomiAgentWalletsCreated,
  AomiClient,
  AomiWalletBalance,
} from "@aomi-labs/client";

/**
 * The account's agent wallets, in the server's order, and how to create
 * them. `client` is the one Settings reads the account through.
 */
export function useAgentWallets(client: AomiClient | undefined) {
  const { refreshAccount } = useAomiWalletKit();
  const query = useDisplayQuery({
    resource: "account-wallets",
    enabled: Boolean(client),
    fetcher: (signal) => client!.account.wallets.listWallets({ signal }),
  });
  const refresh = query.refetch;
  const create = useCallback(
    async (): Promise<AomiAgentWalletsCreated> => {
      const result = await client!.account.wallets.createAgentWallets();
      if (!refreshAccount)
        throw new Error("Wallet unavailable. Refresh and retry.");
      await refreshAccount();
      await refresh();
      return result;
    },
    [client, refresh, refreshAccount],
  );
  const agents: AomiAccountWallet[] | undefined = query.data?.filter(
    (wallet) => wallet.kind === "agent",
  );
  return {
    wallets: agents,
    status: query.isPending ? "loading" : query.error ? "error" : "ready",
    error: query.error,
    refresh,
    create,
  } as const;
}

/** One wallet's balance (the server caches it for 30 s). */
export function useWalletBalance(
  client: AomiClient | undefined,
  id: string | undefined,
) {
  return useDisplayQuery<AomiWalletBalance>({
    resource: "wallet-balance",
    parameters: [id],
    enabled: Boolean(client && id),
    fetcher: (signal) => client!.account.wallets.walletBalance(id!, { signal }),
  });
}
