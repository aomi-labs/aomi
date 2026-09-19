"use client";

import { useCallback, useEffect, useState } from "react";
import { AomiFrame } from "../aomi-frame";
import { useAomiWalletKit } from "../../lib/wallet-kit";
import type { WalletAccountMenuOptions } from "../control-bar/account-menu-types";
import { HeaderControls } from "./components/shell/header-controls";
import { usePortalWalletAccountMenu } from "./components/shell/use-portal-wallet-account-menu";
import { ShellNavigationContext } from "./link";
import { StatementView } from "./features/usage/statement-view";
import { PackagesModal } from "./components/shell/packages-modal";
import {
  SettingsModal,
  type SettingsTab,
} from "./components/settings/settings-modal";

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
    embedded: true,
  });
  useEffect(() => onAccountMenuChange(menu), [menu, onAccountMenuChange]);
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
