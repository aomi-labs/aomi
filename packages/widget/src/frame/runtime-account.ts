"use client";

import { useMemo } from "react";
import type { RuntimeAccount } from "@aomi-labs/react";
import { useAomiWalletKit } from "../wallet/context";

/** Who the runtime talks to the backend as, read from the wallet kit. */
export function useRuntimeAccount(): RuntimeAccount | null | undefined {
  const {
    isReady,
    accountStatus,
    accountUser,
    accountGuest,
    accountGuestUserId,
  } = useAomiWalletKit();
  const userId = accountUser?.id;
  // Only a guest the account read confirmed; other guest metadata is ignored.
  const guestId =
    accountStatus === "ready" && accountGuest ? accountGuestUserId : undefined;
  return useMemo(() => {
    if (isReady === false || accountStatus === "loading") return undefined;
    if (userId) return { kind: "user", id: userId };
    if (guestId) return { kind: "guest", id: guestId };
    return null;
  }, [isReady, accountStatus, userId, guestId]);
}
