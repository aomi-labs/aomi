"use client";

import { Fragment, useEffect, useState, type FC } from "react";
import { LoadingLine } from "@/ui/aomi/loading-pane";
import { ChevronsUpDownIcon } from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import { useAomiWalletKit } from "./context";
import { formatWalletAddress } from "./identity";
import { signOutAndDisconnect } from "@/wallet/account/sign-out";
import { WalletIconSlot } from "./wallet-icon-slot";
import { useWalletPicker } from "@/wallet/picker/wallet-picker-context";
import { AccountAvatar } from "@/account/account-avatar";
import { AccountMenu } from "@/account/account-menu";
import { AccountStatusLine } from "@/account/account-status-line";
import { useAccountSnapshot } from "@/account/account-snapshot";
import { appName } from "@/account/account-management/wallet-model";
import { StatusPill } from "@/ui/aomi/status-pill";
import { DisconnectConfirmDialog } from "./disconnect-confirm-dialog";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";
import { shortAddress } from "@aomi-labs/client";

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

function solanaClusterLabel(cluster?: string): string | undefined {
  if (!cluster) return undefined;
  const name = cluster.replace("solana:", "");
  if (!name) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The account chip. The frame owns the wallet sheet it opens. */
export const DualWalletBar: FC<DualWalletBarProps> = ({
  families,
  className,
  disconnectedLabel = "Connect wallet",
  onConnectionChange,
  accountMenu,
}) => {
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const { openPicker } = useWalletPicker();
  const [snapshot, saveSnapshot] = useAccountSnapshot();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionAction, setSessionAction] = useState<
    "signout" | "disconnect" | null
  >(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);

  const connected = Boolean(identity.address || identity.svmAddress);
  const accountMenuEnabled = Boolean(accountMenu?.enabled);
  const walletKitBooting = !adapter.isReady && !adapter.canConnect;
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
  const accountId = adapter.accountUser?.id;
  const cachedStatus = snapshot?.accountId === accountId ? snapshot : null;
  const creditsLine = accountMenu?.secondaryLine ?? cachedStatus?.creditsLine;
  const planLabel = accountMenu?.planLabel ?? cachedStatus?.planLabel;
  const secondaryLine = accountMenuEnabled ? (
    accountMenu?.secondaryLoading && !creditsLine ? (
      <LoadingLine className="h-[11px] w-20" />
    ) : creditsLine ? (
      <AccountStatusLine creditsLine={creditsLine} planLabel={planLabel} />
    ) : undefined
  ) : connectedWallets.some((wallet) => wallet.detail) ? (
    networkDetail
  ) : undefined;
  const walletLabel =
    accountMenu?.walletLabel ??
    primaryWallet?.walletName ??
    (primaryWallet?.family === "solana" ? "Solana" : "Ethereum");
  const visibleAddress =
    identity.address ?? identity.svmAddress ?? primaryWallet?.address;
  const signedIn = Boolean(adapter.accountUser && !adapter.accountGuest);
  const needsVerify = accountMenuEnabled && Boolean(adapter.unlinkedWallet);
  // Until the session is known, show the saved account (or a skeleton of the
  // same size), never "Sign in".
  const sessionPending =
    !accountMenuEnabled &&
    (adapter.accountStatus === "loading" ||
      walletKitBooting ||
      (signedIn && !connected));
  const signedOut = adapter.accountStatus === "ready" && !signedIn;
  const snapshotName = accountMenu?.primaryLine;
  const activeWallets = adapter.wallets
    .filter((row) => row.active)
    .map((row) => `${row.family}|${row.address}|${appName(row)}`)
    .join(",");

  useEffect(() => {
    if (accountMenuEnabled && accountId && snapshotName) {
      saveSnapshot({
        accountId,
        name: snapshotName,
        creditsLine,
        planLabel,
        wallets: activeWallets
          ? activeWallets.split(",").map((entry) => {
              const [family, address, brand] = entry.split("|");
              return {
                family: family as "evm" | "svm",
                address,
                brand,
              };
            })
          : [],
      });
    } else if (signedOut) {
      saveSnapshot(null);
    }
  }, [
    accountId,
    accountMenuEnabled,
    activeWallets,
    saveSnapshot,
    signedOut,
    snapshotName,
    creditsLine,
    planLabel,
  ]);

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
    if (sessionAction === "signout") {
      // Close first; errors from the session being ended are not shown.
      setSessionAction(null);
      try {
        if (accountMenu?.onSignOut) {
          try {
            await accountMenu.onSignOut();
          } finally {
            await adapter.disconnect?.({ family: "all" });
          }
        } else {
          await signOutAndDisconnect(adapter);
        }
      } catch {
        // The old session is gone either way.
      }
      return;
    }
    setSessionActionBusy(true);
    try {
      if (accountMenu?.onDisconnect) {
        await accountMenu.onDisconnect();
      } else {
        await adapter.disconnect?.({ family: "all" });
      }
      setSessionAction(null);
    } catch (err) {
      // Keep the dialog open for a retry; disconnect must never silently
      // fall through to a sign-out.
      console.warn("[DualWalletBar] disconnect failed", err);
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
    // One chip shape for every state so signing in does not resize it.
    "@container rounded-xl border p-3",
    className,
  );

  return (
    <>
      <div className="relative w-full">
        <button
          type="button"
          onClick={handleChipClick}
          disabled={sessionPending}
          aria-busy={sessionPending ? true : undefined}
          className={chipClassName}
          aria-label={
            accountMenuEnabled
              ? "Open account menu"
              : sessionPending
                ? "Loading account"
                : disconnectedLabel
          }
          aria-expanded={accountMenuEnabled ? menuOpen : undefined}
        >
          {sessionPending ? (
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              {snapshot ? (
                <>
                  <AccountAvatar
                    seed={snapshot.accountId}
                    size={AVATAR_SIZE}
                    className="ring-aomi-border bg-aomi-surface-2 shrink-0 rounded-full ring-1"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-aomi-fg truncate text-[12px] font-medium leading-none">
                      {snapshot.name}
                    </span>
                    {snapshot.creditsLine ? (
                      // Same wrapper as the live line, so nothing shifts on swap.
                      <span className="text-aomi-muted truncate text-[11px] leading-none">
                        <AccountStatusLine
                          creditsLine={snapshot.creditsLine}
                          planLabel={snapshot.planLabel}
                        />
                      </span>
                    ) : (
                      <LoadingLine className="h-[11px] w-20" />
                    )}
                  </span>
                </>
              ) : (
                <>
                  <LoadingLine className="size-7 shrink-0 rounded-full" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <LoadingLine className="h-[11px] w-28" />
                    <LoadingLine className="h-[11px] w-16" />
                  </span>
                </>
              )}
            </span>
          ) : accountMenuEnabled ? (
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <AccountAvatar
                seed={accountId}
                size={AVATAR_SIZE}
                className="ring-aomi-border bg-aomi-surface-2 shrink-0 rounded-full ring-1"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-aomi-fg truncate text-[12px] font-medium leading-none">
                    {accountMenu?.primaryLine ??
                      (primaryWallet
                        ? shortAddress(primaryWallet.address, {
                            head: 12,
                            tail: 8,
                          })
                        : "Account")}
                  </span>
                  {needsVerify ? (
                    <StatusPill
                      tone="warning"
                      className="h-4 px-1.5 text-[10px]"
                    >
                      Verify
                    </StatusPill>
                  ) : null}
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
                {accountId ? (
                  <AccountAvatar seed={accountId} size={AVATAR_SIZE} />
                ) : (
                  connectedWallets.map((wallet, index) => (
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
                  ))
                )}
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
                            {shortAddress(wallet.address, {
                              head: 12,
                              tail: 8,
                            })}
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
            <span className="flex h-7 min-w-0 flex-1 items-center gap-2.5">
              {accountId ? (
                <AccountAvatar seed={accountId} size={AVATAR_SIZE} />
              ) : null}
              <span className="truncate text-sm font-medium">
                {disconnectedLabel}
              </span>
            </span>
          )}
          <ChevronsUpDownIcon className="text-aomi-muted size-4 shrink-0" />
        </button>

        {accountMenuEnabled ? (
          <AccountMenu
            open={menuOpen}
            accountLabel={accountMenu?.primaryLine}
            accountId={accountId}
            address={visibleAddress}
            walletLabel={walletLabel}
            allowanceLine={accountMenu?.secondaryLine}
            planLabel={accountMenu?.planLabel}
            allowanceLoading={accountMenu?.secondaryLoading}
            noticeLine={accountMenu?.noticeLine}
            themeLabel={accountMenu?.themeLabel}
            rows={adapter.wallets}
            unlinked={adapter.unlinkedWallet}
            onClose={() => setMenuOpen(false)}
            onManageAccount={wrapMenuAction(accountMenu?.onManageAccount)}
            onToggleTheme={wrapMenuAction(accountMenu?.onToggleTheme)}
            onOpenSettings={wrapMenuAction(accountMenu?.onOpenSettings)}
            onSignIn={wrapMenuAction(accountMenu?.onSignIn)}
            onActivateWallet={adapter.activateWallet}
            onAddWallet={() => {
              setMenuOpen(false);
              adapter.openAddWallet?.();
            }}
            onVerify={adapter.openVerify}
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
    </>
  );
};
