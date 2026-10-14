"use client";

import { useCallback } from "react";
import { useOptionalAomiRuntime } from "@aomi-labs/react";

export function useWalletActivationGuard(): () => boolean {
  const runtime = useOptionalAomiRuntime();

  return useCallback(() => {
    if (!runtime?.hasBlockingActions) {
      return true;
    }

    runtime.showNotification({
      type: "wallet",
      title: "Finish the pending action",
      message:
        "Approve or reject the current action before switching wallets or networks.",
    });
    return false;
  }, [runtime]);
}
