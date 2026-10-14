"use client";

import { useCallback, useEffect, useState } from "react";
import { AomiFrame } from "./aomi-frame";
import { useAomiWalletKit } from "@/wallet/context";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
import { HeaderControls } from "./header-controls";
import { usePortalWalletAccountMenu } from "@/account/use-portal-wallet-account-menu";
import { ShellNavigationContext } from "@/ui/link";
import { StatementView } from "@/account/usage/statement-view";
import { PackagesModal } from "@/library/packages-modal";
import { SettingsModal, type SettingsTab } from "@/account/settings-modal";
import { useSettingsOpenRequest } from "@/account/settings-events";

/** Optional controls on the Portal-equivalent embedded shell. */
export type AomiWidgetFeatures = {
  settings?: boolean;
  library?: boolean;
  theme?: boolean;
  activity?: boolean;
};

export function WidgetShell({
  onAccountMenuChange,
  features,
  showHeader,
  showSidebar,
  showNetwork,
}: {
  onAccountMenuChange: (menu: WalletAccountMenuOptions | undefined) => void;
  features?: AomiWidgetFeatures;
  showHeader: boolean;
  showSidebar: boolean;
  showNetwork: boolean;
}) {
  const wallet = useAomiWalletKit();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsTab("general"), []);
  const openAccount = useCallback(() => setSettingsTab("account"), []);
  const menu = usePortalWalletAccountMenu(openSettings, openAccount, {
    ...features,
  });
  useEffect(() => onAccountMenuChange(menu), [menu, onAccountMenuChange]);
  // In-chat controls (the composer's safety menu) deep-link into Settings.
  useSettingsOpenRequest((tab) => {
    if (features?.settings !== false) setSettingsTab(tab);
  });
  return (
    <ShellNavigationContext.Provider
      value={(path) => {
        setSettingsTab(null);
        setStatementOpen(path === "/statement");
      }}
    >
      {showHeader ? (
        <AomiFrame.Header showSidebarTrigger={showSidebar}>
          <HeaderControls
            onOpenSettings={openSettings}
            onOpenPackages={() => setLibraryOpen(true)}
            showSettings={
              features?.settings !== false && Boolean(wallet.accountUser)
            }
            showLibrary={features?.library !== false}
            showTheme={features?.theme !== false}
            showActivity={features?.activity !== false}
            showNetwork={showNetwork}
          />
        </AomiFrame.Header>
      ) : null}
      {settingsTab ? (
        <SettingsModal
          key={settingsTab}
          accountOnly={features?.settings === false}
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
        />
      ) : null}
      {libraryOpen && features?.library !== false ? (
        <PackagesModal onClose={() => setLibraryOpen(false)} />
      ) : null}
      {statementOpen ? (
        <div
          role="dialog"
          aria-label="Usage statement"
          className="bg-aomi-bg absolute inset-0 z-50 overflow-auto"
        >
          <StatementView />
        </div>
      ) : null}
    </ShellNavigationContext.Provider>
  );
}
