import {
  Ellipsis,
  Loader2,
  Unlink,
  Unplug,
  UserRoundMinus,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@aomi-labs/react";
import { aomiButton } from "../../../../ui/aomi/button";
import { StatusPill } from "../../../../ui/aomi/status-pill";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../../ui/popover";
import type { LinkedAuthAccount } from "../../../../../lib/wallet-kit/account/types";
import { shortenAddress } from "../account-api";
import { WalletProviderAvatar } from "../wallet-brands";
import type { ManagedWallet } from "../wallet-management-model";
import {
  addressLineStatus,
  familyName,
  providerName,
  type LoginProvider,
} from "./wallet-groups";

type WalletHandler = (wallet: ManagedWallet) => Promise<void>;

export type WalletLineHandlers = {
  pending: string | null;
  onLink?: WalletHandler;
  onConnect?: WalletHandler;
  onSelect?: WalletHandler;
  onDisconnect?: WalletHandler;
  onUnlink?: WalletHandler;
};

const hasAction = (
  wallet: ManagedWallet,
  kind: ManagedWallet["actions"][number]["kind"],
) => wallet.actions.some((action) => action.kind === kind);

const canUnlink = (wallet: ManagedWallet, onUnlink?: WalletHandler) =>
  Boolean(onUnlink && wallet.linkedWalletId && hasAction(wallet, "unlink"));

/**
 * A Para or Privy login: a static header (logo, identifier, whether it is
 * signed in here, and the login's ⋯) over one address line per wallet.
 */
export function ProviderWalletCard({
  provider,
  identity,
  wallets,
  onUnlinkSignIn,
  ...handlers
}: WalletLineHandlers & {
  provider: LoginProvider;
  identity?: LinkedAuthAccount;
  wallets: ManagedWallet[];
  onUnlinkSignIn?: (account: LinkedAuthAccount) => Promise<void>;
}) {
  const { pending, onDisconnect, onUnlink } = handlers;
  const name = providerName(provider);
  const signedIn = wallets.some(
    (wallet) =>
      wallet.connected &&
      (wallet.state === "ready" ||
        (wallet.state === "offline" && wallet.reason === "selection_required")),
  );
  const detail = [
    identity?.displayLabel ?? identity?.email,
    wallets.length
      ? signedIn
        ? "signed in on this device"
        : "not signed in on this device"
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const disconnectable = onDisconnect
    ? wallets.filter((wallet) => hasAction(wallet, "disconnect"))
    : [];
  const actions: WalletMenuAction[] = [];
  if (disconnectable.length) {
    actions.push({
      label: "Disconnect on this device",
      icon: <Unplug size={15} />,
      onSelect: async () => {
        for (const wallet of disconnectable) await onDisconnect!(wallet);
      },
    });
  }
  for (const wallet of wallets) {
    if (!canUnlink(wallet, onUnlink)) continue;
    actions.push({
      label: `Unlink ${familyName(wallet)} address`,
      icon: <Unlink size={15} />,
      onSelect: () => onUnlink!(wallet),
    });
  }
  if (identity && onUnlinkSignIn) {
    actions.push({
      label: `Unlink ${name} sign-in`,
      icon: <UserRoundMinus size={15} />,
      onSelect: () => onUnlinkSignIn(identity),
    });
  }
  const busy =
    (identity !== undefined && pending === `unlink-identity:${identity.id}`) ||
    wallets.some(
      (wallet) =>
        pending === `disconnect:${wallet.key}` ||
        pending === `unlink:${wallet.key}`,
    );

  return (
    <div data-wallet-provider={provider}>
      <div className="flex min-h-14 items-center gap-3 px-3.5 py-3">
        <WalletProviderAvatar markKey={provider} size={17} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="type-row truncate">{name}</span>
          {detail ? (
            <span className="type-meta text-aomi-muted truncate">{detail}</span>
          ) : null}
        </div>
        {actions.length ? (
          <WalletActionsMenu
            label={`Actions for ${name}`}
            actions={actions}
            disabled={pending !== null}
            busy={busy}
          />
        ) : null}
      </div>
      {wallets.map((wallet) => (
        <AddressLine key={wallet.key} wallet={wallet} nested {...handlers} />
      ))}
    </div>
  );
}

/** An external wallet: one address line in the shared wallet group. */
export function ExternalWalletCard({
  wallet,
  ...handlers
}: WalletLineHandlers & { wallet: ManagedWallet }) {
  return <AddressLine wallet={wallet} {...handlers} />;
}

/**
 * The click target for a wallet. A selectable line makes that address the
 * active one for its family; the active line carries the green bar and glow.
 * Lines that cannot be selected show only their status and inline fix.
 */
function AddressLine({
  wallet,
  nested = false,
  pending,
  onLink,
  onConnect,
  onSelect,
  onDisconnect,
  onUnlink,
}: WalletLineHandlers & { wallet: ManagedWallet; nested?: boolean }) {
  const family = familyName(wallet);
  const short = shortenAddress(wallet.address);
  const title =
    wallet.walletName ??
    wallet.label ??
    (wallet.provider ? titleCase(wallet.provider) : undefined) ??
    `${family} wallet`;
  const status = addressLineStatus(wallet);
  const inlineHandler =
    status?.action?.kind === "link"
      ? onLink
      : status?.action
        ? onConnect
        : undefined;
  const selectable = Boolean(hasAction(wallet, "select") && onSelect);
  const busy = pending?.endsWith(wallet.key) ?? false;

  const menuActions: WalletMenuAction[] = [];
  if (!nested && hasAction(wallet, "disconnect") && onDisconnect) {
    menuActions.push({
      label: "Disconnect",
      icon: <Unplug size={15} />,
      onSelect: () => onDisconnect(wallet),
    });
  }
  if (!nested && canUnlink(wallet, onUnlink)) {
    menuActions.push({
      label: "Unlink wallet",
      icon: <Unlink size={15} />,
      onSelect: () => onUnlink!(wallet),
    });
  }

  const address = `${short} · ${family}`;
  const content = nested ? (
    <span className="type-address text-aomi-fg min-w-0 truncate">
      {address}
    </span>
  ) : (
    <>
      <WalletProviderAvatar
        markKey={`${wallet.walletName ?? ""} ${wallet.label ?? ""} ${wallet.provider ?? ""}`}
        size={17}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="type-row truncate">{title}</span>
        <span className="type-address text-aomi-muted truncate">{address}</span>
      </span>
    </>
  );
  const padding = nested ? "min-h-11 py-2.5 pl-[58px]" : "min-h-14 py-3 pl-3.5";

  return (
    <div
      data-wallet-state={wallet.operating ? "active" : wallet.state}
      className={cn(
        "group relative flex items-center transition-colors",
        nested && "border-aomi-border border-t",
        wallet.operating
          ? "bg-aomi-success/[0.045]"
          : selectable &&
              "hover:bg-aomi-hover has-[:focus-visible]:ring-aomi-accent-strong/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset",
      )}
    >
      {wallet.operating ? (
        <span
          className="bg-aomi-success absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full shadow-[0_0_12px_color-mix(in_srgb,var(--aomi-success)_45%,transparent)]"
          aria-hidden="true"
        />
      ) : null}
      {selectable ? (
        <button
          type="button"
          aria-label={`Make ${short} active`}
          disabled={pending !== null}
          onClick={() => void onSelect?.(wallet)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 self-stretch pr-3 text-left outline-none disabled:cursor-default",
            padding,
          )}
        >
          {content}
          <span className="type-meta text-aomi-muted ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
            Use for {family}
          </span>
        </button>
      ) : (
        <div
          className={cn("flex min-w-0 flex-1 items-center gap-3 pr-3", padding)}
        >
          {content}
        </div>
      )}
      {status || menuActions.length ? (
        <div className="flex shrink-0 items-center gap-2 py-2 pr-3.5">
          {status ? (
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          ) : null}
          {status?.action && inlineHandler ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void inlineHandler(wallet)}
              className={aomiButton({ variant: "secondary", size: "sm" })}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {status.action.label}
            </button>
          ) : null}
          {menuActions.length ? (
            <WalletActionsMenu
              label={`Actions for ${title} ${short}`}
              actions={menuActions}
              disabled={pending !== null}
              busy={busy && !(status?.action && inlineHandler)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TextButton({
  children,
  danger = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
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
      className={aomiButton({
        variant: danger ? "danger" : "secondary",
        size: "sm",
      })}
    >
      {busy ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
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
      className={aomiButton({ variant: "ghost", size: "icon" })}
    >
      {busy ? <Loader2 className="animate-spin" /> : children}
    </button>
  );
}

type WalletMenuAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => unknown;
};

function WalletActionsMenu({
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
          className={aomiButton({ variant: "ghost", size: "icon" })}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Ellipsis className="size-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={label}
        align="end"
        sideOffset={5}
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-card shadow-popover z-[90] w-max min-w-40 max-w-[calc(100vw-2rem)] border p-1"
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
            className="hover:bg-aomi-hover focus:bg-aomi-hover type-control flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left outline-none"
            onClick={() => {
              setOpen(false);
              void action.onSelect();
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
