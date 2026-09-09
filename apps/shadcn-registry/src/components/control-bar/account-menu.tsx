"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlusIcon,
  UnplugIcon,
  WalletCardsIcon,
} from "lucide-react";
import { formatWalletAddress } from "../../lib/wallet-kit";
import { WalletIconSlot } from "./wallet-icon-slot";

export type AccountMenuProps = {
  open: boolean;
  accountLabel?: string;
  address?: string;
  walletLabel?: string;
  allowanceLine?: string;
  noticeLine?: string;
  networkLabel?: string;
  themeLabel?: string;
  wallets?: readonly {
    id: string;
    address: string;
    walletLabel: string;
    active: boolean;
  }[];
  onClose: () => void;
  onManageAccount?: () => void;
  onSwitchNetwork?: () => void;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onOpenDeployments?: () => void;
  onSignIn?: () => void;
  onSelectWallet?: (id: string) => Promise<void>;
  onAddWallet?: () => void;
  onSignOut: () => void;
  onDisconnect: () => void;
};

function MenuRow({
  label,
  trailing,
  onClick,
}: {
  label: string;
  trailing?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-aomi-fg hover:bg-aomi-surface-2 flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] transition-colors"
    >
      <span>{label}</span>
      {trailing ? (
        <span className="text-aomi-muted text-[12px]">{trailing}</span>
      ) : null}
    </button>
  );
}

export function AccountMenu({
  open,
  accountLabel,
  address,
  walletLabel,
  allowanceLine,
  noticeLine,
  networkLabel,
  themeLabel,
  wallets = [],
  onClose,
  onManageAccount,
  onSwitchNetwork,
  onToggleTheme,
  onOpenSettings,
  onOpenDeployments,
  onSignIn,
  onSelectWallet,
  onAddWallet,
  onSignOut,
  onDisconnect,
}: AccountMenuProps) {
  const [sessionOpen, setSessionOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [switchingWalletId, setSwitchingWalletId] = useState<string>();

  useEffect(() => {
    if (!open) {
      setSessionOpen(false);
      setWalletsOpen(false);
      setSwitchingWalletId(undefined);
    }
  }, [open]);

  if (!open) return null;

  const shortAddress = address ? formatWalletAddress(address) : undefined;
  const networkTrailing = networkLabel
    ? `${networkLabel.slice(0, 8)} ›`
    : "Network ›";
  const canQuickSwitch = wallets.length > 0 && Boolean(onSelectWallet);

  const selectWallet = async (id: string, active: boolean) => {
    if (active || !onSelectWallet || switchingWalletId) return;
    setSwitchingWalletId(id);
    try {
      await onSelectWallet(id);
      setWalletsOpen(false);
    } catch (error) {
      console.warn("[AccountMenu] wallet switch failed", error);
    } finally {
      setSwitchingWalletId(undefined);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Dismiss account menu"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        role="menu"
        aria-label="Account menu"
        className="border-aomi-border bg-aomi-raised absolute bottom-[calc(100%+8px)] left-0 z-50 flex max-h-[calc(100dvh-1rem)] w-[min(248px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-xl border p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
      >
        <div className="bg-aomi-surface-2/55 mx-0.5 mb-2 rounded-lg px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <WalletIconSlot
                  label={walletLabel ?? "Wallet"}
                  size={14}
                  className="bg-aomi-surface-2 shrink-0 rounded-full"
                />
                <span className="truncate text-[13px] font-semibold">
                  {accountLabel ?? walletLabel ?? "Account"}
                </span>
              </div>
              {shortAddress ? (
                <div className="text-aomi-muted mt-1 truncate font-mono text-[11px]">
                  {shortAddress}
                </div>
              ) : null}
            </div>

            {canQuickSwitch || onAddWallet ? (
              <button
                type="button"
                aria-label="Quick switch wallet"
                aria-expanded={walletsOpen}
                onClick={() => setWalletsOpen((value) => !value)}
                className="border-aomi-border bg-aomi-raised hover:bg-aomi-hover flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors"
              >
                <span className="flex items-center -space-x-1.5">
                  {wallets.slice(0, 2).map((wallet) => (
                    <WalletIconSlot
                      key={wallet.id}
                      label={wallet.walletLabel}
                      size={18}
                      className="ring-aomi-raised bg-aomi-surface-2 rounded-full ring-2"
                    />
                  ))}
                  {wallets.length === 0 ? (
                    <WalletCardsIcon
                      className="text-aomi-muted mx-0.5"
                      size={14}
                    />
                  ) : null}
                </span>
                <ChevronsUpDownIcon
                  className="text-aomi-muted ml-1"
                  size={12}
                />
              </button>
            ) : null}
          </div>
          {allowanceLine ? (
            <div className="text-aomi-muted mt-2 text-[12px] font-medium">
              {allowanceLine}
            </div>
          ) : null}
          {noticeLine ? (
            <p className="text-aomi-muted mt-2 text-[12px] leading-snug">
              {noticeLine}
            </p>
          ) : null}

          {walletsOpen ? (
            <div
              role="group"
              aria-label="Quick wallet switcher"
              className="border-aomi-border/70 mt-2 border-t pt-2"
            >
              <div className="flex flex-col gap-0.5">
                {wallets.map((wallet) => {
                  const pending = switchingWalletId === wallet.id;
                  return (
                    <button
                      key={wallet.id}
                      type="button"
                      aria-label={
                        wallet.active
                          ? `${wallet.walletLabel} is active`
                          : `Use ${wallet.walletLabel}`
                      }
                      disabled={Boolean(switchingWalletId)}
                      onClick={() =>
                        void selectWallet(wallet.id, wallet.active)
                      }
                      className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors ${
                        wallet.active
                          ? "bg-aomi-raised/80"
                          : "hover:bg-aomi-raised/65"
                      }`}
                    >
                      <WalletIconSlot
                        label={wallet.walletLabel}
                        size={22}
                        className="bg-aomi-raised shrink-0 rounded-full"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-aomi-fg block truncate text-[11px] font-medium">
                          {wallet.walletLabel}
                        </span>
                        <span className="text-aomi-muted block truncate font-mono text-[10px]">
                          {formatWalletAddress(wallet.address)}
                        </span>
                      </span>
                      {pending ? (
                        <LoaderCircleIcon
                          className="text-aomi-muted animate-spin"
                          size={13}
                        />
                      ) : wallet.active ? (
                        <span className="bg-aomi-success/12 text-aomi-success flex size-5 items-center justify-center rounded-full">
                          <CheckIcon size={12} strokeWidth={2.5} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {onAddWallet ? (
                <button
                  type="button"
                  onClick={onAddWallet}
                  className="text-aomi-muted hover:bg-aomi-raised/65 hover:text-aomi-fg mt-0.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors"
                >
                  <span className="border-aomi-border flex size-[22px] items-center justify-center rounded-full border">
                    <PlusIcon size={12} />
                  </span>
                  Add wallet
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {onSignIn ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="bg-aomi-fg text-aomi-bg mx-0.5 mb-1 flex h-9 w-[calc(100%-4px)] items-center justify-center rounded-lg px-2.5 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        ) : null}

        {onManageAccount ? (
          <MenuRow
            label="Manage account"
            trailing="›"
            onClick={onManageAccount}
          />
        ) : null}
        {onSwitchNetwork ? (
          <MenuRow
            label="Switch network"
            trailing={networkTrailing}
            onClick={onSwitchNetwork}
          />
        ) : null}
        {onToggleTheme ? (
          <MenuRow
            label="Theme"
            trailing={`${themeLabel ?? "Auto"} ›`}
            onClick={onToggleTheme}
          />
        ) : null}
        {onOpenSettings ? (
          <MenuRow label="Settings" onClick={onOpenSettings} />
        ) : null}
        {onOpenDeployments ? (
          <MenuRow
            label="Deployments"
            trailing="›"
            onClick={onOpenDeployments}
          />
        ) : null}
        <a
          href="https://aomi.dev/docs"
          target="_blank"
          rel="noreferrer"
          className="text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-9 items-center rounded-lg px-2.5 text-[13px] transition-colors"
          onClick={onClose}
        >
          Docs
        </a>
        <div className="border-aomi-border/70 mx-0.5 mt-2 border-t pt-2">
          <button
            type="button"
            aria-expanded={sessionOpen}
            onClick={() => setSessionOpen((value) => !value)}
            className="text-aomi-fg hover:bg-aomi-surface-2 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors"
          >
            <WalletCardsIcon className="text-aomi-muted" size={14} />
            <span className="flex-1 text-left">Session &amp; wallet</span>
            <ChevronDownIcon
              className={`text-aomi-muted transition-transform ${sessionOpen ? "rotate-180" : ""}`}
              size={14}
            />
          </button>

          {sessionOpen ? (
            <div className="bg-aomi-bg/45 border-aomi-border/70 mt-1 overflow-hidden rounded-lg border p-1">
              {address ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="hover:bg-aomi-surface-2 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors"
                >
                  <UnplugIcon className="text-aomi-muted shrink-0" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="text-aomi-fg block text-[12px] font-medium">
                      Disconnect {walletLabel ?? "wallet"}
                    </span>
                    <span className="text-aomi-muted block text-[11px] leading-snug">
                      Keep the Aomi account signed in
                    </span>
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSignOut}
                className="hover:bg-aomi-danger/5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors"
              >
                <LogOutIcon className="text-aomi-danger shrink-0" size={14} />
                <span className="min-w-0 flex-1">
                  <span className="text-aomi-danger block text-[12px] font-medium">
                    Sign out
                  </span>
                  <span className="text-aomi-muted block text-[11px] leading-snug">
                    End the Aomi session; keep wallet connected
                  </span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
