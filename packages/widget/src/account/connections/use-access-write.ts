"use client";

import { useState } from "react";
import type {
  AomiAccountConnection,
  AomiAgentWallet,
  AomiConnectionWalletsUpdate,
} from "@aomi-labs/client";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { useShellTransport } from "@/account/transport";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { pairsWith, type PairMode } from "./connection-pairs";

/**
 * Gives an agent wallet `mode` on a connection, or takes its access away
 * with null; Instant asks first. While a connection saves, `saving[key]` is
 * the list it will hold, so ticks and switches move at once and the server
 * catches up behind them. Render `dialog`.
 */
export function useAccessWrite() {
  const { client } = useShellTransport();
  const refresh = useRefreshWallets();
  const { confirm, dialog } = useConfirmDialog();
  const [saving, setSaving] = useState<
    Record<string, AomiConnectionWalletsUpdate["wallets"]>
  >({});
  const [error, setError] = useState<string | null>(null);

  const write = async (
    connection: AomiAccountConnection,
    wallet: AomiAgentWallet,
    mode: PairMode | null,
    /** The connection's name in the Instant prompt. */
    title: string,
  ) => {
    const { key } = connection;
    if (saving[key]) return;
    if (
      mode === "instant" &&
      !(await confirm({
        title: "Sign without asking?",
        description: `Trades from ${title} with "${wallet.name}" will sign without asking.`,
        confirmLabel: "Turn on",
      }))
    )
      return;
    const wallets = pairsWith(connection, wallet.id, mode);
    setSaving((current) => ({ ...current, [key]: wallets }));
    setError(null);
    try {
      await client.account.connections.setConnectionWallets(key, { wallets });
      await refresh();
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setSaving(({ [key]: _, ...rest }) => rest);
    }
  };

  return { write, saving, error, dialog };
}
