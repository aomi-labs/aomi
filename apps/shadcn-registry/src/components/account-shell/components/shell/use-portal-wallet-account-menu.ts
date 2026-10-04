"use client";

import { useMemo } from "react";
import { useAomiWalletKit } from "../../../../lib/wallet-kit/context";
import type { WalletAccountMenuOptions } from "../../../control-bar/account-menu-types";
import { formatAllowanceSummary } from "../../lib/account-overview";
import { useCreditAllowance } from "../../lib/use-credit-allowance";
import { useShellTransport } from "../../transport";
import { useSettings } from "../../lib/use-settings";
import {
  accountDisplayName,
  providerEmailDisplayHint,
} from "../../features/account/wallet-management-model";

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
  const allowance = useCreditAllowance();
  const credits = allowance.data;
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

    // A wallet can be connected while the Aomi account session is missing:
    // the provider credential exchange either has not run yet or it failed.
    const secondaryLine =
      credits && credits.included > 0
        ? formatAllowanceSummary(credits.used, credits.included)
        : credits
          ? `${Math.max(0, credits.included - credits.used).toLocaleString()} credits left`
          : allowance.status === "error"
            ? "Allowance unavailable"
            : "Loading allowance…";

    const isDark =
      settings.colorMode === "dark" ||
      (settings.colorMode === "auto" &&
        typeof document !== "undefined" &&
        (themeRoot ?? document.documentElement).classList.contains("dark"));

    return {
      enabled: true,
      primaryLine: accountDisplayName(accountUser, displayEmailHint),
      secondaryLine,
      noticeLine:
        accountError ??
        (allowance.status === "error" && !credits
          ? "Couldn’t load allowance. Retry in Settings."
          : undefined),
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
    credits,
    allowance.status,
    settings.colorMode,
    updateSetting,
    themeRoot,
    options.settings,
    options.theme,
    options.onOpenDeployments,
    options.embedded,
  ]);
}
