"use client";

import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/ui/sidebar";
import { ThreadList } from "./thread-list";
import { ConnectButton } from "@/wallet/connect-button";
import { AomiLogo } from "@/ui/aomi-logo";
import { ProductSwitcher, type SidebarProduct } from "./product-switcher";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
import { testIds } from "@/test-ids";

type ThreadListSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /** Position of the wallet button: "header" (top), "footer" (bottom), or null (hidden) */
  walletPosition?: "header" | "footer" | null;
  walletFamilies?: Array<"evm" | "solana">;
  walletConnectLabel?: string;
  walletAccountMenu?: WalletAccountMenuOptions;
  /** Products offered in the wordmark dropdown. Pass `null` for a plain wordmark. */
  products?: SidebarProduct[] | null;
  /** Which product this widget instance is; controls the badge and the checkmark. */
  currentProductId?: string;
};

export function ThreadListSidebar({
  walletPosition = "footer",
  walletFamilies,
  walletConnectLabel,
  walletAccountMenu,
  products = null,
  currentProductId = "chat",
  ...props
}: ThreadListSidebarProps) {
  return (
    <Sidebar
      collapsible="offcanvas"
      variant="inset"
      className="bg-aomi-surface border-aomi-border relative border-r"
      data-testid={testIds.sidebar}
      {...props}
    >
      <SidebarHeader className="aomi-sidebar-header">
        <div className="aomi-sidebar-header-content mb-3 ml-4 mt-4 flex items-center justify-between">
          {/* Wordmark row per the design mock: logo · Aomi · badge · chevron */}
          {products && products.length > 0 ? (
            <ProductSwitcher
              products={products}
              currentProductId={currentProductId}
            />
          ) : (
            <AomiLogo
              className="aomi-sidebar-header-logo text-[17px]"
              markClassName="aomi-sidebar-header-icon"
            />
          )}
          {walletPosition === "header" && (
            <ConnectButton
              families={walletFamilies}
              connectLabel={walletConnectLabel}
              accountMenu={walletAccountMenu}
            />
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="aomi-sidebar-content mr-0">
        <ThreadList />
      </SidebarContent>
      <SidebarRail />
      {walletPosition === "footer" && (
        <SidebarFooter className="aomi-sidebar-footer mx-3 mb-4 border-0 pt-1">
          <div className="border-aomi-border mx-2 mb-1 border-t" />
          <ConnectButton
            className="w-full"
            families={walletFamilies}
            connectLabel={walletConnectLabel}
            accountMenu={walletAccountMenu}
          />
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
