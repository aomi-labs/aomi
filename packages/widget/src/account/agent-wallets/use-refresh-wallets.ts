"use client";

import { useCallback } from "react";
import { useAomiDisplayCache } from "@aomi-labs/react";
import { useAomiWalletKit } from "@/wallet/context";

/**
 * After an agent wallet or lane write: the wallet lists (pause-all rides on
 * the agent list), the connections (they name their wallets), and the kit's
 * own rows.
 */
export function useRefreshWallets(): () => Promise<void> {
  const cache = useAomiDisplayCache();
  const refreshAccount = useAomiWalletKit().refreshAccount;
  return useCallback(async () => {
    await Promise.all([
      refreshAccount?.(),
      ...(cache
        ? (["account-wallets", "connections"] as const).map((resource) =>
            cache.client.invalidateQueries({ queryKey: cache.key(resource) }),
          )
        : []),
    ]);
  }, [cache, refreshAccount]);
}
