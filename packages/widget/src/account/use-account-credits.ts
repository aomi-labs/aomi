"use client";

import {
  displayQueries,
  useAomiDisplayCache,
  useDisplayQuery,
} from "@aomi-labs/react";
import { useShellTransport } from "./transport";
import { useAomiWalletKit } from "../wallet/context";

/**
 * One display read serves the account chip, Settings, Usage and Credit Bank.
 * It reads the runtime's client from the display cache, not the runtime
 * context, so the chip does not re-render for every streamed token.
 */
export function useAccountCredits(enabled?: boolean) {
  const runtimeClient = useAomiDisplayCache()?.apiClient;
  const transport = useShellTransport();
  const wallet = useAomiWalletKit();
  return useDisplayQuery(
    displayQueries.credits(
      runtimeClient ?? transport.client,
      enabled ?? Boolean(wallet.accountUser && !wallet.accountGuest),
    ),
  );
}
