"use client";

import { useEffect, useRef } from "react";
import type { AomiWalletKit } from "@/wallet/types";
import { evmConnectorUid } from "@/wallet/wallet-utils";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import type { WalletAppSwitch } from "./use-sheet-flow";

/** The connected addresses of each wallet app connection, by its connector. */
function addressesByConnection(kit: AomiWalletKit): Map<string, WalletRow[]> {
  const byConnection = new Map<string, WalletRow[]>();
  for (const row of kit.wallets) {
    if (row.kind !== "external" || !row.connectionId) continue;
    const connection =
      row.family === "evm"
        ? evmConnectorUid(row.connectionId)
        : `svm:${row.brand ?? row.connectionId}`;
    byConnection.set(connection, [
      ...(byConnection.get(connection) ?? []),
      row,
    ]);
  }
  return byConnection;
}

/**
 * A wallet app that swaps one address for another on the same connection
 * switched accounts inside the app. A page load only adds connections, so it
 * never counts as a switch.
 */
export function useWalletAppSwitch(
  kit: AomiWalletKit,
  onSwitch: (change: WalletAppSwitch) => void,
) {
  const previous = useRef<Map<string, WalletRow[]> | null>(null);
  useEffect(() => {
    const next = addressesByConnection(kit);
    const before = previous.current;
    previous.current = next;
    if (!before) return;
    for (const [connection, rows] of next) {
      const earlier = before.get(connection);
      if (!earlier) continue;
      const added = rows.find(
        (row) => !earlier.some((candidate) => candidate.key === row.key),
      );
      const removed = earlier.find(
        (row) => !rows.some((candidate) => candidate.key === row.key),
      );
      if (added && removed) onSwitch({ row: added, previous: removed });
    }
  }, [kit, onSwitch]);
}
