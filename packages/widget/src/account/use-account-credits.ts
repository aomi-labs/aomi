"use client";

import { displayQueries, useDisplayQuery } from "@aomi-labs/react";
import { useAomi } from "./transport";
import { useAomiWalletKit } from "../wallet/context";

/**
 * One display read serves the account chip, Settings, Usage and Credit balance.
 * It reads the runtime's client from the display cache, not the runtime
 * context, so the chip does not re-render for every streamed token.
 */
function useCreditClient(enabled?: boolean) {
  const aomi = useAomi();
  const wallet = useAomiWalletKit();
  return {
    aomi,
    enabled: enabled ?? Boolean(wallet.accountUser && !wallet.accountGuest),
  };
}

export function useAccountCredits(enabled?: boolean) {
  const context = useCreditClient(enabled);
  return useDisplayQuery(displayQueries.credits(context.aomi, context.enabled));
}

export function useAccountCreditLedger(enabled?: boolean) {
  const context = useCreditClient(enabled);
  return useDisplayQuery(
    displayQueries.creditLedger(context.aomi, context.enabled),
  );
}
