"use client";

import { useEffect, useMemo, useState } from "react";
import { getChainInfo, useAomiRuntime } from "@aomi-labs/react";
import {
  useAomiWalletKit,
  type WalletAccountMenuOptions,
} from "@aomi-labs/widget-lib";
import { formatAllowanceSummary } from "@portal/lib/account-overview";
import { useSettings } from "@portal/lib/use-settings";

function openHeaderNetworkSelect() {
  document
    .querySelector<HTMLElement>("[data-aomi-network-select-trigger]")
    ?.click();
}

/**
 * Portal-only account menu config for the sidebar wallet chip.
 * Reuses the shared `/api/account` overview — same source as General settings.
 */
export function usePortalWalletAccountMenu(
  onOpenSettings: () => void,
  onManageAccount: () => void = onOpenSettings,
): WalletAccountMenuOptions | undefined {
  const { account: runtimeAccount } = useAomiRuntime();
  const [credits, setCredits] = useState<{
    used: number;
    included: number;
  } | null>(null);
  const { settings, updateSetting } = useSettings();
  const adapter = useAomiWalletKit();
  const {
    accounts,
    accountGuest,
    accountUser,
    accountError,
    identity,
  } = adapter;
  const activeAccount = accounts.find((account) => account.active);

  useEffect(() => {
    if (!accountUser || accountGuest) {
      setCredits(null);
      return;
    }
    let mounted = true;
    void runtimeAccount.credits
      .get({ limit: 1 })
      .then((position) => {
        if (mounted) {
          setCredits({
            used: position.included.used_microusd / 10_000,
            included: position.included.limit_microusd / 10_000,
          });
        }
      })
      .catch(() => {
        if (mounted) setCredits(null);
      });
    return () => {
      mounted = false;
    };
  }, [accountGuest, accountUser, runtimeAccount]);

  return useMemo(() => {
    // A Better Auth guest is only transport for guest chat. Do not present it
    // as an account or offer account-management actions; linking a wallet
    // replaces this temporary session with a verified wallet sign-in.
    if (!accountUser || accountGuest) return undefined;

    // A wallet can be connected while the Aomi account session is missing:
    // the provider credential exchange either has not run yet or it failed.
    const secondaryLine =
      credits && credits.included > 0
        ? formatAllowanceSummary(credits.used, credits.included)
        : credits
          ? `${Math.max(0, credits.included - credits.used).toLocaleString()} credits left`
          : "Loading allowance…";

    const isDark =
      settings.colorMode === "dark" ||
      (settings.colorMode === "auto" &&
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark"));

    const networkLabel =
      getChainInfo(identity.chainId)?.name ??
      identity.svmCluster?.replace(/^solana:/, "") ??
      undefined;

    return {
      enabled: true,
      primaryLine:
        accountUser.displayName ?? accountUser.email ?? "Aomi account",
      secondaryLine,
      noticeLine: accountError,
      walletLabel: activeAccount?.walletName,
      networkLabel,
      themeLabel: isDark ? "Dark" : "Light",
      onSwitchNetwork: openHeaderNetworkSelect,
      onToggleTheme: () =>
        updateSetting("colorMode", isDark ? "light" : "dark"),
      onManageAccount,
      onOpenSettings,
      onOpenDeployments: () => {
        window.location.assign("/deployments");
      },
      // No session overrides: DualWalletBar keeps account sign-out and wallet
      // connector teardown as two explicit, independent actions.
    };
  }, [
    accountError,
    accountGuest,
    accountUser,
    activeAccount?.walletName,
    identity.chainId,
    identity.svmCluster,
    onManageAccount,
    onOpenSettings,
    credits,
    settings.colorMode,
    updateSetting,
  ]);
}
