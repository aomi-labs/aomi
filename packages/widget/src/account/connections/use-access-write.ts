"use client";

import { useState } from "react";
import type {
  AomiAccountConnection,
  AomiConnectionWalletsUpdate,
  AomiLane,
} from "@aomi-labs/client";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { useShellAomi } from "@/account/transport";
import { useRefreshWallets } from "@/account/agent-wallets/use-refresh-wallets";

/**
 * Sets a connection's lane on an agent wallet; Instant asks first. While a
 * connection saves, `saving[key]` is the list it will hold, so the picker
 * moves at once and the server catches up behind it. Render `dialog`.
 */
export function useAccessWrite() {
  const aomi = useShellAomi();
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
    // Archived wallets stay listed too, so a Restore brings their lanes back.
    const wallets: AomiConnectionWalletsUpdate["wallets"] = [
      ...connection.wallets
        .filter((entry) => entry.id !== wallet.id)
        .map((entry) => ({ id: entry.id, lane: entry.lane })),
      { id: wallet.id, lane: connection.ask_only ? "portal" : lane },
    ];
    setSaving((current) => ({ ...current, [key]: wallets }));
    setError(null);
    try {
      await aomi.account.connections.setConnectionWallets(key, { wallets });
      await refresh();
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setSaving(({ [key]: _, ...rest }) => rest);
    }
  };

  return { write, saving, error, dialog };
}
