"use client";

import { Fragment, useEffect, useState, type FC } from "react";
import { ChevronsUpDownIcon, UnfoldVerticalIcon } from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import {
  useAomiWalletKit,
  formatWalletAddress,
  signOutAndDisconnect,
} from "../../lib/wallet-kit";
import { WalletIconSlot } from "./wallet-icon-slot";
import { WalletPicker } from "./wallet-picker";
import { WalletPickerProvider, useWalletPicker } from "./wallet-picker-context";
import { AccountMenu } from "./account-menu";
import { DisconnectConfirmDialog } from "./disconnect-confirm-dialog";
import type { WalletAccountMenuOptions } from "./account-menu-types";

export type DualWalletBarProps = {
  families: Array<"evm" | "solana">;
  className?: string;
  disconnectedLabel?: string;
  onConnectionChange?: (connected: boolean) => void;
  /** Optional account menu layer — portal passes live allowance + action callbacks. */
  accountMenu?: WalletAccountMenuOptions;
};

type ConnectedWallet = {
  family: "evm" | "solana";
  walletName?: string;
  address: string;
  detail?: string;
};

const AVATAR_SIZE = 28;

/** Longer middle-truncated address, revealed when the bar has room to grow. */
function longAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 12)}..${address.slice(-8)}`;
}

function solanaClusterLabel(cluster?: string): string | undefined {
  if (!cluster) return undefined;
  const name = cluster.replace("solana:", "");
  if (!name) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const DualWalletBarInner: FC<DualWalletBarProps> = ({
  families,
  className,
  disconnectedLabel = "Connect wallet",
  onConnectionChange,
  accountMenu,
}) => {
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const { openPicker } = useWalletPicker();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionAction, setSessionAction] = useState<
    "signout" | "disconnect" | null
  >(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);

  const connected = Boolean(identity.address || identity.svmAddress);
  const accountMenuEnabled = Boolean(accountMenu?.enabled);
  const activeEvmAccount = adapter.accounts.find(
    (account) => account.family === "evm" && account.active,
  );
  const activeSolanaAccount = adapter.accounts.find(
    (account) => account.family === "svm" && account.active,
  );
  const connectedWallets = families
    .map((family): ConnectedWallet | null =>
      family === "evm"
        ? identity.address
          ? {
              family,
              walletName: activeEvmAccount?.walletName,
              address: identity.address,
              detail: getChainInfo(
                activeEvmAccount?.chainId ?? identity.chainId,
              )?.name,
            }
          : null
        : identity.svmAddress
          ? {
              family,
              walletName:
                activeSolanaAccount?.walletName ?? identity.svmWalletName,
              address: identity.svmAddress,
              detail: solanaClusterLabel(identity.svmCluster),
            }
          : null,
    )
    .filter((wallet): wallet is ConnectedWallet => wallet !== null);
  const singleWallet = connectedWallets.length === 1;
  const primaryWallet = connectedWallets[0];
  const networkDetail = connectedWallets
    .map((wallet) => wallet.detail)
    .filter(Boolean)
    .join(" · ");
  const secondaryLine = accountMenuEnabled
    ? (accountMenu?.secondaryLine ?? "Allowance —")
    : connectedWallets.some((wallet) => wallet.detail)
      ? networkDetail
      : undefined;
  const walletLabel =
    accountMenu?.walletLabel ??
    primaryWallet?.walletName ??
    (primaryWallet?.family === "solana" ? "Solana" : "Ethereum");
  const visibleAddress =
    identity.address ?? identity.svmAddress ?? primaryWallet?.address;
  const quickSwitchWallets = adapter.accounts
    .filter((account) => account.family === "evm")
    .map((account) => ({
      id: account.id,
      address: account.address,
      walletLabel: account.walletName ?? "Ethereum wallet",
      active: account.active,
    }));

  useEffect(() => {
    onConnectionChange?.(identity.isConnected);
  }, [identity.isConnected, onConnectionChange]);

  useEffect(() => {
    if (!connected && !accountMenuEnabled) {
      setMenuOpen(false);
      setSessionAction(null);
    }
  }, [accountMenuEnabled, connected]);

  const handleChipClick = () => {
    if (accountMenuEnabled) {
      setMenuOpen((open) => !open);
      return;
    }
    openPicker();
  };

  const handleSessionActionRequest = (action: "signout" | "disconnect") => {
    setMenuOpen(false);
    setSessionAction(action);
  };

  const handleSessionActionConfirm = async () => {
    if (!sessionAction) return;
    setSessionActionBusy(true);
    try {
      if (sessionAction === "signout") {
        if (accountMenu?.onSignOut) {
          try {
            await accountMenu.onSignOut();
          } finally {
            await adapter.disconnect?.({ family: "all" });
          }
        } else {
          await signOutAndDisconnect(adapter);
        }
      } else {
        if (accountMenu?.onDisconnect) {
          await accountMenu.onDisconnect();
        } else {
          await adapter.disconnect?.({ family: "all" });
        }
      }
      setSessionAction(null);
    } catch (err) {
      // Keep the dialog open for a retry so either session action remains
      // explicit and never silently falls through to the other teardown.
      console.warn(`[DualWalletBar] ${sessionAction} failed`, err);
    } finally {
      setSessionActionBusy(false);
    }
  };

  const wrapMenuAction = (action?: () => void) => {
    if (!action) return undefined;
    return () => {
      setMenuOpen(false);
      action();
    };
  };

  const chipClassName = cn(
    "inline-flex w-full items-center justify-between gap-2.5 whitespace-nowrap text-left transition-colors",
    "border-aomi-border text-aomi-fg hover:bg-aomi-hover/80 bg-transparent",
    "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    accountMenuEnabled
      ? "rounded-lg border p-2.5"
      : "@container rounded-xl border p-3",
    className,
  );

  const chipChevron = accountMenuEnabled ? (
    <UnfoldVerticalIcon className="text-aomi-muted size-4 shrink-0" />
  ) : (
    <ChevronsUpDownIcon className="text-aomi-muted size-4 shrink-0" />
  );

  return (
    <>
      <div className="relative w-full">
        <button
          type="button"
          onClick={handleChipClick}
          className={chipClassName}
          aria-label={
            accountMenuEnabled ? "Open account menu" : disconnectedLabel
          }
          aria-expanded={accountMenuEnabled ? menuOpen : undefined}
        >
          {accountMenuEnabled ? (
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <WalletIconSlot
                label={walletLabel}
                size={AVATAR_SIZE}
                className="ring-aomi-border bg-aomi-surface-2 shrink-0 rounded-full ring-1"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-aomi-fg truncate text-[12px] font-medium leading-none">
                  {accountMenu?.primaryLine ??
                    (primaryWallet
                      ? longAddress(primaryWallet.address)
                      : "Account")}
                </span>
                {secondaryLine ? (
                  <span className="text-aomi-muted truncate text-[11px] leading-none">
                    {secondaryLine}
                  </span>
                ) : null}
              </span>
            </span>
          ) : connected && connectedWallets.length ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex shrink-0 items-center">
                {connectedWallets.map((wallet, index) => (
                  <WalletIconSlot
                    key={wallet.family}
                    label={
                      wallet.walletName ??
                      (wallet.family === "solana" ? "Solana" : "Ethereum")
                    }
                    size={AVATAR_SIZE}
                    className={cn(
                      "ring-aomi-border bg-aomi-surface-2 rounded-full ring-1",
                      index > 0 && "-ml-2",
                    )}
                  />
                ))}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="min-w-0 truncate text-[13px] font-medium">
                  {connectedWallets.map((wallet, index) => (
                    <Fragment key={wallet.family}>
                      {index > 0 ? (
                        <span className="text-aomi-muted/60">{" / "}</span>
                      ) : null}
                      {singleWallet ? (
                        <>
                          <span className="@[15rem]:hidden">
                            {formatWalletAddress(wallet.address)}
                          </span>
                          <span className="@[15rem]:inline hidden">
                            {longAddress(wallet.address)}
                          </span>
                        </>
                      ) : (
                        <span>{formatWalletAddress(wallet.address)}</span>
                      )}
                    </Fragment>
                  ))}
                </span>
                {secondaryLine ? (
                  <span className="text-aomi-muted min-w-0 truncate text-[11px]">
                    {secondaryLine}
                  </span>
                ) : null}
              </span>
            </span>
          ) : (
            <span className="flex h-7 min-w-0 flex-1 items-center">
              <span className="truncate text-sm font-medium">
                {disconnectedLabel}
              </span>
            </span>
          )}
          {chipChevron}
        </button>

        {accountMenuEnabled ? (
          <AccountMenu
            open={menuOpen}
            accountLabel={accountMenu?.primaryLine}
            address={visibleAddress}
            walletLabel={walletLabel}
            allowanceLine={accountMenu?.secondaryLine}
            noticeLine={accountMenu?.noticeLine}
            networkLabel={accountMenu?.networkLabel ?? networkDetail}
            themeLabel={accountMenu?.themeLabel}
            wallets={quickSwitchWallets}
            onClose={() => setMenuOpen(false)}
            onManageAccount={wrapMenuAction(accountMenu?.onManageAccount)}
            onSwitchNetwork={wrapMenuAction(accountMenu?.onSwitchNetwork)}
            onToggleTheme={wrapMenuAction(accountMenu?.onToggleTheme)}
            onOpenSettings={wrapMenuAction(accountMenu?.onOpenSettings)}
            onOpenDeployments={wrapMenuAction(accountMenu?.onOpenDeployments)}
            onSignIn={wrapMenuAction(accountMenu?.onSignIn)}
            onSelectWallet={(id) => adapter.selectAccount(id)}
            onAddWallet={() => {
              setMenuOpen(false);
              openPicker();
            }}
            onSignOut={() => handleSessionActionRequest("signout")}
            onDisconnect={() => handleSessionActionRequest("disconnect")}
          />
        ) : null}
      </div>

      <DisconnectConfirmDialog
        open={sessionAction !== null}
        mode={sessionAction ?? "signout"}
        address={visibleAddress}
        busy={sessionActionBusy}
        onConfirm={() => void handleSessionActionConfirm()}
        onCancel={() => setSessionAction(null)}
      />
      <WalletPicker />
    </>
  );
};

export const DualWalletBar: FC<DualWalletBarProps> = (props) => {
  return (
    <WalletPickerProvider>
      <DualWalletBarInner {...props} />
    </WalletPickerProvider>
  );
};
