"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@aomi-labs/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { ConnectButton } from "@/components/control-bar/connect-button";
import { AomiLogo } from "@/components/aomi-logo";
import { AomiMark } from "@/components/aomi-mark";
import type { WalletAccountMenuOptions } from "@/components/control-bar/account-menu-types";

/** One entry in the wordmark dropdown (an Aomi surface the user can switch to). */
export type SidebarProduct = {
  id: string;
  /** Badge rendered next to the wordmark when this product is the current one. */
  badge: string;
  label: string;
  description?: string;
  href: string;
};

export const DEFAULT_SIDEBAR_PRODUCTS: SidebarProduct[] = [
  {
    id: "chat",
    badge: "Chat",
    label: "Aomi Chat",
    description: "Talk to onchain agents",
    href: "https://chat.aomi.dev",
  },
  {
    id: "build",
    badge: "Build",
    label: "Aomi Build",
    description: "Build and deploy agents",
    href: "https://build.aomi.dev",
  },
];

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

function ProductSwitcher({
  products,
  currentProductId,
}: {
  products: SidebarProduct[];
  currentProductId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const current =
    products.find((product) => product.id === currentProductId) ?? products[0];

  const wordmark = (
    <>
      <AomiLogo
        className="aomi-sidebar-header-logo text-[17px]"
        markClassName="aomi-sidebar-header-icon"
      />
      {current?.badge && (
        <span className="bg-aomi-surface-2 text-aomi-muted flex h-[17px] items-center rounded-sm px-1.5 text-[10px] font-medium uppercase leading-none tracking-wide">
          {current.badge}
        </span>
      )}
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch Aomi product"
          className="hover:bg-aomi-hover/60 -ml-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors"
        >
          {wordmark}
          <ChevronDown
            className={cn(
              "text-aomi-muted size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="border-aomi-overlay-border bg-aomi-raised w-60 rounded-xl border p-1.5"
      >
        {products.map((product) => {
          const isCurrent = product.id === current?.id;
          return (
            <a
              key={product.id}
              href={product.href}
              {...(isCurrent
                ? {}
                : { target: "_blank", rel: "noopener noreferrer" })}
              onClick={() => setOpen(false)}
              className="text-aomi-fg hover:bg-aomi-hover focus-visible:bg-aomi-hover flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none transition-colors"
            >
              <AomiMark className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {product.label}
                </span>
                {product.description && (
                  <span className="text-aomi-muted truncate text-xs">
                    {product.description}
                  </span>
                )}
              </span>
              {isCurrent && (
                <Check className="text-aomi-muted ml-auto size-4 shrink-0" />
              )}
            </a>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function ThreadListSidebar({
  walletPosition = "footer",
  walletFamilies,
  walletConnectLabel,
  walletAccountMenu,
  products = DEFAULT_SIDEBAR_PRODUCTS,
  currentProductId = "chat",
  ...props
}: ThreadListSidebarProps) {
  return (
    <Sidebar
      collapsible="offcanvas"
      variant="inset"
      className="bg-aomi-surface border-aomi-border relative border-r"
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
