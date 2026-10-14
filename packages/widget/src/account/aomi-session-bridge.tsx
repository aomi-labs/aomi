"use client";

import { useShellTransport } from "./transport";
import { useAomiDisplayCache } from "@aomi-labs/react";
import { useCallback, useEffect, useState } from "react";
import { useAomiWalletKit } from "@/wallet/context";
import {
  useAccountOverviewStore,
  type AccountOverview,
} from "./account-overview";

const SESSION_RETRY_BUDGET_MS = 8_000;
const SESSION_RETRY_BASE_DELAY_MS = 300;
const SESSION_RETRY_MAX_DELAY_MS = 1_500;
const SESSION_RETRY_BACKOFF_FACTOR = 1.7;
const ADAPTER_SETTLE_BUDGET_MS = 8_000;
// The exchange can report "done" a beat before its session cookie is readable
// by /api/account. Keep a short retry window even when nothing is in flight so
// a freshly created session is not reported as anonymous.
const SESSION_SETTLE_GRACE_MS = 1_500;

export type AomiSessionStatus =
  | "anonymous"
  | "establishing"
  | "error"
  | "ready";

export function useAomiSession(): {
  status: AomiSessionStatus;
  retry: () => void;
} {
  const transport = useShellTransport();
  const cache = useAomiDisplayCache();
  const { seedAccountOverview } = useAccountOverviewStore();
  const adapter = useAomiWalletKit();
  const adapterStatus = adapter.identity.status;
  const accountStatus = adapter.accountStatus;
  const accountGuest = adapter.accountGuest === true;
  const accountUserId = adapter.accountUser?.id;
  const cachedProfile =
    cache &&
    accountStatus === "ready" &&
    accountUserId &&
    cache.scope.account?.id === accountUserId
      ? cache.client.getQueryData<AccountOverview>(cache.key("profile"))
      : undefined;
  const hasWarmProfile = Boolean(
    cachedProfile?.user.user_id === accountUserId && accountUserId,
  );
  const [probeStatus, setProbeStatus] = useState<AomiSessionStatus>(
    hasWarmProfile ? "ready" : "establishing",
  );
  const [probeAttempt, setProbeAttempt] = useState(0);
  // A provider whose account exchange never settles (accountStatus stuck on
  // "loading") must not hold the gate on "Connecting…" forever — after this
  // deadline we probe /api/account anyway and let its answer decide.
  const [adapterWaitExpired, setAdapterWaitExpired] = useState(false);

  const adapterSettling =
    adapterStatus === "booting" ||
    (adapterStatus === "connected" && accountStatus === "loading");

  useEffect(() => {
    if (!adapterSettling) {
      setAdapterWaitExpired(false);
      return;
    }
    const timer = globalThis.setTimeout(
      () => setAdapterWaitExpired(true),
      ADAPTER_SETTLE_BUDGET_MS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [adapterSettling]);

  useEffect(() => {
    if (accountGuest) {
      seedAccountOverview(null);
      setProbeStatus("anonymous");
      return;
    }
    if (adapterSettling && !adapterWaitExpired) {
      setProbeStatus("establishing");
      return;
    }

    let cancelled = false;
    setProbeStatus(hasWarmProfile ? "ready" : "establishing");

    const run = async () => {
      let nextDelay = SESSION_RETRY_BASE_DELAY_MS;
      let waitedMs = 0;
      // Only a provider exchange that is still running justifies the long
      // retry budget. Once it settles (success or failure) a 401 is the real
      // answer, so the gate can offer sign-in instead of spinning.
      const exchangeInFlight =
        adapterStatus === "connected" && accountStatus === "loading";
      const retryBudgetMs = exchangeInFlight
        ? SESSION_RETRY_BUDGET_MS
        : SESSION_SETTLE_GRACE_MS;

      for (;;) {
        try {
          if (
            cache &&
            accountStatus === "ready" &&
            accountUserId &&
            cache.scope.account?.id === accountUserId
          ) {
            await cache.client.fetchQuery({
              queryKey: cache.key("profile"),
              staleTime: 5 * 60_000,
              retry: false,
              queryFn: async ({ signal }) => {
                const response = await transport.fetch("/api/account", {
                  signal,
                  cache: "no-store",
                  headers: { "X-Thread-Id": "settings-session-probe" },
                });
                if (!response.ok)
                  throw Object.assign(
                    new Error("Account display unavailable"),
                    {
                      status: response.status,
                    },
                  );
                const profile = (await response.json()) as AccountOverview;
                if (profile.user.user_id !== accountUserId)
                  throw new Error(
                    "Account changed while its profile was loading",
                  );
                return profile;
              },
            });
            if (!cancelled) setProbeStatus("ready");
            return;
          }
          const response = await transport.fetch("/api/account", {
            cache: "no-store",
            headers: { "X-Thread-Id": "settings-session-probe" },
          });
          if (cancelled) return;
          if (response.ok) {
            // The probe already paid for the account payload — share it so
            // the settings tabs don't refetch /api/account individually.
            try {
              seedAccountOverview((await response.json()) as AccountOverview);
            } catch {
              // Non-JSON body; consumers fetch on demand instead.
            }
            setProbeStatus("ready");
            return;
          }
          if (response.status === 401 && waitedMs < retryBudgetMs) {
            setProbeStatus("establishing");
          } else if (response.status === 401) {
            seedAccountOverview(null);
            setProbeStatus("anonymous");
            return;
          } else {
            setProbeStatus("error");
            return;
          }
        } catch (error) {
          if (cancelled) return;
          const status =
            error && typeof error === "object" && "status" in error
              ? error.status
              : undefined;
          if (status === 401 && waitedMs < retryBudgetMs) {
            setProbeStatus("establishing");
          } else if (status === 401) {
            seedAccountOverview(null);
            setProbeStatus("anonymous");
            return;
          } else {
            setProbeStatus("error");
            return;
          }
        }

        await new Promise((resolve) =>
          globalThis.setTimeout(resolve, nextDelay),
        );
        waitedMs += nextDelay;
        nextDelay = Math.min(
          Math.round(nextDelay * SESSION_RETRY_BACKOFF_FACTOR),
          SESSION_RETRY_MAX_DELAY_MS,
        );
        if (cancelled) return;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    cache,
    hasWarmProfile,
    adapterSettling,
    accountGuest,
    adapterStatus,
    accountStatus,
    accountUserId,
    adapterWaitExpired,
    probeAttempt,
    transport,
    seedAccountOverview,
  ]);

  // `connect` runs the provider auth flow, which re-arms the credential
  // exchange that mints the Aomi session. `openAccountUI` only opens the
  // provider's account management popup and would leave the gate unchanged.
  const retry = useCallback(() => {
    setProbeAttempt((attempt) => attempt + 1);
    void adapter.connect?.();
  }, [adapter]);

  return {
    status: probeStatus,
    retry,
  };
}
