import {
  Ellipsis,
  Link2,
  Loader2,
  Plug,
  Plus,
  Unlink,
  Unplug,
  UserRoundMinus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../../ui/popover";
import type { LinkedAuthAccount } from "../../../../../lib/wallet-kit/account/types";
import { shortenAddress } from "../account-api";
import { WalletProviderAvatar } from "../wallet-brands";
import type { ManagedWallet } from "../wallet-management-model";

export function WalletRow({
  wallet,
  pending,
  onLink,
  onConnect,
  onSelect,
  onDisconnect,
  onUnlink,
  signInMethods = [],
  onUnlinkSignIn,
}: {
  wallet: ManagedWallet;
  signInMethods?: LinkedAuthAccount[];
  onUnlinkSignIn?: (account: LinkedAuthAccount) => Promise<void>;
  pending: string | null;
  onLink?: (wallet: ManagedWallet) => Promise<void>;
  onConnect?: (wallet: ManagedWallet) => Promise<void>;
  onSelect?: (wallet: ManagedWallet) => Promise<void>;
  onDisconnect?: (wallet: ManagedWallet) => Promise<void>;
  onUnlink?: (wallet: ManagedWallet) => Promise<void>;
}) {
  const providerBrandKey =
    wallet.provider === "privy" || wallet.provider === "para"
      ? wallet.provider
      : undefined;
  const title =
    (providerBrandKey ? titleCase(providerBrandKey) : undefined) ??
    wallet.walletName ??
    wallet.label ??
    (wallet.provider ? titleCase(wallet.provider) : undefined) ??
    (wallet.family === "evm" ? "EVM wallet" : "SVM wallet");
  const busy = pending?.endsWith(wallet.key) ?? false;
  const hasAction = (kind: ManagedWallet["actions"][number]["kind"]) =>
    wallet.actions.some((action) => action.kind === kind);
  const selectable = Boolean(hasAction("select") && onSelect);
  const stateDetail =
    wallet.state === "mismatch"
      ? "This provider wallet does not match the wallet linked to your account."
      : wallet.state === "loading"
        ? "Checking this wallet against your account…"
        : wallet.state === "offline" && wallet.reason === "provider_unavailable"
          ? `${wallet.provider ? titleCase(wallet.provider) : "This wallet provider"} is not available on this site.`
          : wallet.state === "offline" && wallet.reason === "signer_unavailable"
            ? "This wallet's signer is unavailable. Sign in again to reconnect it."
            : wallet.state === "offline" && wallet.reason === "account_error"
              ? "Could not verify this wallet against your account. Refresh to try again."
              : wallet.state === "offline" &&
                  wallet.reason === "selection_required"
                ? "Ready to use. Select this wallet to make it active."
                : wallet.state === "offline"
                  ? null
                  : null;
  const menuActions: WalletMenuAction[] = [];
  if (hasAction("link") && onLink && wallet.kind === "external") {
    menuActions.push({
      label: "Link",
      icon: <Link2 size={15} />,
      onSelect: () => void onLink(wallet),
    });
  }
  if ((hasAction("connect") || hasAction("reauthenticate")) && onConnect) {
    menuActions.push({
      label: hasAction("reauthenticate") ? "Sign in again" : "Connect",
      icon: <Plug size={15} />,
      onSelect: () => void onConnect(wallet),
    });
  }
  if (hasAction("disconnect") && onDisconnect) {
    menuActions.push({
      label: "Disconnect",
      icon: <Unplug size={15} />,
      onSelect: () => void onDisconnect(wallet),
    });
  }
  if (hasAction("unlink") && wallet.linkedWalletId && onUnlink) {
    menuActions.push({
      label: "Unlink wallet",
      icon: <Unlink size={15} />,
      onSelect: () => void onUnlink(wallet),
    });
  }
  if (onUnlinkSignIn) {
    for (const account of signInMethods) {
      menuActions.push({
        label: `Unlink ${titleCase(account.provider)} sign-in`,
        icon: <UserRoundMinus size={15} />,
        onSelect: () => void onUnlinkSignIn(account),
      });
    }
  }
  const walletContent = (
    <>
      <WalletProviderAvatar
        markKey={
          providerBrandKey ??
          `${wallet.walletName ?? ""} ${wallet.label ?? ""} ${wallet.provider ?? ""}`
        }
        size={17}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{title}</span>
          {wallet.connected ? (
            <StatusBadge label="Connected" tone="connected" />
          ) : null}
          {wallet.linked ? <StatusBadge label="Linked" tone="linked" /> : null}
          {wallet.operating ? (
            <StatusBadge label="Active" tone="active" />
          ) : null}
        </div>
        <span className="text-aomi-muted block truncate font-mono text-[11px]">
          {shortenAddress(wallet.address)} ·{" "}
          {wallet.family === "evm" ? "EVM" : "SVM"}
        </span>
        {stateDetail ? (
          <span
            className={`mt-0.5 block text-[11px] ${
              wallet.state === "mismatch"
                ? "text-aomi-danger"
                : "text-aomi-muted"
            }`}
          >
            {stateDetail}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div
      data-wallet-state={
        wallet.operating
          ? "active"
          : wallet.state === "mismatch"
            ? "mismatch"
            : wallet.connected
              ? "connected"
              : "linked"
      }
      className={`relative flex items-stretch transition-colors ${
        wallet.operating
          ? "bg-aomi-success/[0.045]"
          : selectable
            ? "hover:bg-aomi-hover has-[:focus-visible]:ring-aomi-accent-strong/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset"
            : ""
      }`}
    >
      {wallet.operating ? (
        <span
          className="bg-aomi-success absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full shadow-[0_0_12px_rgba(16,185,129,0.45)]"
          aria-hidden="true"
        />
      ) : null}
      {selectable ? (
        <button
          type="button"
          aria-label={`Make ${shortenAddress(wallet.address)} active`}
          disabled={pending !== null}
          onClick={() => void onSelect?.(wallet)}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left outline-none disabled:cursor-default"
        >
          {walletContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
          {walletContent}
        </div>
      )}
      {menuActions.length || busy ? (
        <div className="flex shrink-0 items-center py-3 pr-4">
          <WalletActionsMenu
            label={`Actions for ${title} ${shortenAddress(wallet.address)}`}
            actions={menuActions}
            disabled={pending !== null}
            busy={busy}
          />
        </div>
      ) : null}
    </div>
  );
}

export function OptionGrid<
  T extends { id: string; label: string; markKey?: string; ready: boolean },
>({
  options,
  pending,
  prefix,
  onSelect,
}: {
  options: T[];
  pending: string | null;
  prefix: string;
  onSelect: (option: T) => void;
}) {
  return (
    <div className="border-aomi-border bg-aomi-surface-2/25 grid grid-cols-1 gap-2 rounded-xl border p-2 sm:grid-cols-2">
      {options.map((option) => {
        const busy = pending === `${prefix}:${option.id}`;
        return (
          <button
            key={option.id}
            type="button"
            disabled={!option.ready || busy}
            onClick={() => onSelect(option)}
            className="border-aomi-border bg-aomi-raised hover:bg-aomi-hover text-aomi-fg flex h-10 items-center justify-between rounded-lg border px-3 text-left text-[12px] font-medium transition-colors disabled:opacity-50"
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.markKey ? (
                <WalletProviderAvatar markKey={option.markKey} size={14} />
              ) : null}
              <span className="truncate">{option.label}</span>
            </span>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "connected" | "linked" | "active";
}) {
  const toneClass =
    tone === "active"
      ? "bg-aomi-success/10 text-aomi-success ring-aomi-success/20 ring-1 ring-inset"
      : tone === "connected"
        ? "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/15 dark:text-sky-300"
        : "bg-aomi-surface-2 text-aomi-muted";
  return (
    <span
      className={`${toneClass} rounded-full px-1.5 py-0.5 text-[10px] font-medium`}
    >
      {label}
    </span>
  );
}

export function TextButton({
  children,
  danger = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={`hover:bg-aomi-surface-2 focus-visible:ring-aomi-accent-strong/40 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${danger ? "text-aomi-danger" : "text-aomi-fg"}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  danger = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy || disabled}
      onClick={onClick}
      className={`hover:bg-aomi-surface-2 focus-visible:ring-aomi-accent-strong/40 flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${danger ? "text-aomi-danger" : "text-aomi-muted hover:text-aomi-fg"}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

type WalletMenuAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

export function WalletActionsMenu({
  label,
  actions,
  disabled,
  busy = false,
}: {
  label: string;
  actions: WalletMenuAction[];
  disabled: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          disabled={disabled}
          className="text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg focus-visible:ring-aomi-accent-strong/40 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Ellipsis size={17} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={label}
        align="end"
        sideOffset={5}
        className="border-aomi-border bg-aomi-raised text-aomi-fg z-[90] w-max min-w-40 max-w-[calc(100vw-2rem)] rounded-xl border p-1 shadow-lg"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            ),
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            disabled={disabled}
            className="hover:bg-aomi-surface-2 focus:bg-aomi-surface-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] outline-none"
            onClick={() => {
              setOpen(false);
              action.onSelect();
            }}
          >
            <span className="text-aomi-muted">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
