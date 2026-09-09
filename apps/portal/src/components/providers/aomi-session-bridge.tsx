"use client";

import { useCallback, useEffect, useState } from "react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import {
  seedAccountOverview,
  type AccountOverview,
} from "@portal/lib/account-overview";

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
  const adapter = useAomiWalletKit();
  const adapterStatus = adapter.identity.status;
  const accountStatus = adapter.accountStatus;
  const accountGuest = adapter.accountGuest === true;
  const accountUserId = adapter.accountUser?.id;
  const [probeStatus, setProbeStatus] =
    useState<AomiSessionStatus>("establishing");
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
    setProbeStatus("establishing");

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
          const response = await fetch("/api/account", {
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
        } catch {
          if (cancelled) return;
          setProbeStatus("error");
          return;
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
    adapterSettling,
    accountGuest,
    adapterStatus,
    accountStatus,
    accountUserId,
    adapterWaitExpired,
    probeAttempt,
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
