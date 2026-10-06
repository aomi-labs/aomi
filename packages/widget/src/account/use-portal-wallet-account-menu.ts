"use client";

import { useMemo } from "react";
import { useAccountCredits } from "./use-account-credits";
import { useAomiWalletKit } from "@/wallet/context";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
import {
  creditAllowanceFromPosition,
  formatAllowanceSummary,
} from "./account-overview";
import { useShellTransport } from "./transport";
import { useSettings } from "./use-settings";
import {
  accountDisplayName,
  providerEmailDisplayHint,
} from "@/wallet/wallet-management-model";

/**
 * Shared Portal and widget account menu config for the sidebar wallet chip.
 * Reuses the shared `/api/account` overview — same source as General settings.
 */
export function usePortalWalletAccountMenu(
  onOpenSettings: () => void,
  onManageAccount: () => void = onOpenSettings,
  options: {
    settings?: boolean;
    theme?: boolean;
    onOpenDeployments?: () => void;
    embedded?: boolean;
  } = {},
): WalletAccountMenuOptions | undefined {
  const position = useAccountCredits();
  const credits =
    position.isPending && position.fetchStatus !== "idle"
      ? undefined
      : creditAllowanceFromPosition(position.data);
  // Hosts publish this menu into shell state. Keep its memo dependencies on
  // displayed values; the allowance projection is a new object every render.
  const secondaryLine =
    credits && credits.included > 0
      ? formatAllowanceSummary(credits.used, credits.included)
      : credits
        ? `${Math.max(0, credits.included - credits.used).toLocaleString()} credits left`
        : undefined;
  const secondaryLoading = credits === undefined;
  const { settings, updateSetting } = useSettings();
  const { themeRoot } = useShellTransport();
  const adapter = useAomiWalletKit();
  const { accounts, accountGuest, accountUser, accountError, identity } =
    adapter;
  const activeAccount = accounts.find((account) => account.active);
  const displayEmailHint = accountUser
    ? providerEmailDisplayHint(identity, adapter.accountLinkedAccounts ?? [])
    : undefined;

  return useMemo(() => {
    // A Better Auth guest is only transport for guest chat. Do not present it
    // as an account or offer account-management actions; linking a wallet
    // replaces this temporary session with a verified wallet sign-in.
    if (!accountUser || accountGuest) return undefined;

    const isDark =
      settings.colorMode === "dark" ||
      (settings.colorMode === "auto" &&
        typeof document !== "undefined" &&
        (themeRoot ?? document.documentElement).classList.contains("dark"));

    return {
      enabled: true,
      primaryLine: accountDisplayName(accountUser, displayEmailHint),
      secondaryLine,
      secondaryLoading,
      noticeLine: accountError,
      walletLabel: activeAccount?.walletName,
      themeLabel: isDark ? "Dark" : "Light",
      onToggleTheme:
        options.theme === false
          ? undefined
          : () => updateSetting("colorMode", isDark ? "light" : "dark"),
      onManageAccount,
      onOpenSettings: options.settings === false ? undefined : onOpenSettings,
      onOpenDeployments:
        options.onOpenDeployments ??
        (options.embedded
          ? undefined
          : () => {
              window.location.assign("/deployments");
            }),
      // DualWalletBar owns the unified sign-out and wallet disconnect action.
    };
  }, [
    accountError,
    accountGuest,
    accountUser,
    displayEmailHint,
    activeAccount?.walletName,
    onManageAccount,
    onOpenSettings,
    secondaryLine,
    secondaryLoading,
    settings.colorMode,
    updateSetting,
    themeRoot,
    options.settings,
    options.theme,
    options.onOpenDeployments,
    options.embedded,
  ]);
}
