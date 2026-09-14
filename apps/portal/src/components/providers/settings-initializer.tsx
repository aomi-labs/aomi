"use client";

import { useLayoutEffect, useRef } from "react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { useAccountOverviewStore } from "@portal/lib/account-overview";
import { useSettings } from "@portal/lib/use-settings";

// Client boundary that runs `useSettings()` at the app root so persisted user
// settings (theme/colorMode) load and apply. It also owns the lifetime of the
// shared account overview: changing or signing out the adapter account clears
// account-backed UI before another user can observe the previous snapshot.
export function SettingsInitializer({
  children,
}: {
  children: React.ReactNode;
}) {
  useSettings();
  const { scopeAccountOverviewToUser, seedAccountOverview } =
    useAccountOverviewStore();
  const adapter = useAomiWalletKit();
  const accountUserId = adapter.accountUser?.id;
  const previousAccountUserId = useRef(accountUserId);

  useLayoutEffect(() => {
    const previous = previousAccountUserId.current;
    if (previous && previous !== accountUserId) {
      seedAccountOverview(null);
    } else if (accountUserId) {
      scopeAccountOverviewToUser(accountUserId);
    }
    previousAccountUserId.current = accountUserId;
  }, [accountUserId, scopeAccountOverviewToUser, seedAccountOverview]);

  return <>{children}</>;
}
