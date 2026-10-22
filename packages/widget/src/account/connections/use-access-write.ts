"use client";

import { useState } from "react";
import type {
  AomiAccountConnection,
  AomiConnectionWalletsUpdate,
  AomiLane,
} from "@aomi-labs/client";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { useShellTransport } from "@/account/transport";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";
import { lanesWith } from "./connection-pairs";

/**
 * Sets a connection's lane on an agent wallet; Instant asks first. While a
 * connection saves, `saving[key]` is the list it will hold, so the picker
 * moves at once and the server catches up behind it. Render `dialog`.
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
    wallet: { id: string; name: string },
    lane: AomiLane,
    /** The connection's name in the Instant prompt. */
    title: string,
  ) => {
    const { key } = connection;
    if (saving[key]) return;
    if (
      lane === "instant" &&
      !(await confirm({
        title: "Sign without asking?",
        description: `Trades from ${title} with "${wallet.name}" will sign without asking.`,
        confirmLabel: "Turn on",
      }))
    )
      return;
    const wallets = lanesWith(connection, wallet.id, lane);
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
