import { Link2, Loader2, Plug, Plus, Trash2, Unplug } from "lucide-react";
import { shortenAddress } from "../account-api";
import { WalletProviderAvatar } from "../wallet-brands";
import type { ManagedWallet } from "../wallet-management-model";

export function WalletRow({
  wallet,
  view = "active",
  pending,
  onLink,
  onConnect,
  onSelect,
  onDisconnect,
  onUnlink,
}: {
  wallet: ManagedWallet;
  view?: "linked" | "active";
  pending: string | null;
  onLink?: (wallet: ManagedWallet) => Promise<void>;
  onConnect?: (wallet: ManagedWallet) => Promise<void>;
  onSelect?: (wallet: ManagedWallet) => Promise<void>;
  onDisconnect?: (wallet: ManagedWallet) => Promise<void>;
  onUnlink?: (wallet: ManagedWallet) => Promise<void>;
}) {
  const provider =
    wallet.provider ?? wallet.walletName ?? wallet.label ?? "Wallet";
  const title = shortenAddress(wallet.address);
  const busy = pending?.endsWith(wallet.key) ?? false;
  const hasAction = (kind: ManagedWallet["actions"][number]["kind"]) =>
    wallet.actions.some((action) => action.kind === kind);
  const selectable = Boolean(
    view === "active" && hasAction("select") && onSelect,
  );
  const stateDetail =
    wallet.state === "mismatch"
      ? "This provider wallet does not match the wallet linked to your account."
      : wallet.state === "loading"
        ? "Checking this wallet against your account…"
        : wallet.state === "offline" && wallet.reason === "provider_unavailable"
          ? `${wallet.provider ? titleCase(wallet.provider) : "This wallet provider"} is not available on this site.`
          : wallet.state === "offline"
            ? "Not connected on this device."
            : null;
  const walletContent = (
    <>
      <WalletProviderAvatar
        markKey={`${wallet.walletName ?? ""} ${wallet.label ?? ""} ${
          wallet.provider ?? ""
        }`}
        size={17}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{title}</span>
          {view === "active" ? (
            <StatusBadge label={titleCase(provider)} tone="provider" />
          ) : null}
          {view === "active" && wallet.linked ? (
            <StatusBadge label="Linked" tone="linked" />
          ) : null}
        </div>
        <span className="text-aomi-muted block truncate text-[11px]">
          {view === "linked" ? `${titleCase(provider)} · ` : ""}
          {wallet.family === "evm" ? "Ethereum" : "Solana"}
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
        selectable
          ? "hover:bg-aomi-hover has-[:focus-visible]:ring-aomi-accent-strong/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset"
          : ""
      }`}
    >
      {selectable ? (
        <button
          type="button"
          aria-label={`Make ${title} active`}
          disabled={busy}
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
      <div className="flex shrink-0 items-center gap-1.5 py-3 pr-4">
        {busy ? (
          <Loader2 className="text-aomi-muted size-4 animate-spin" />
        ) : null}
        {!busy &&
        view === "active" &&
        hasAction("link") &&
        onLink &&
        wallet.kind === "external" ? (
          <TextButton onClick={() => void onLink(wallet)}>
            <Link2 size={13} />
            Link
          </TextButton>
        ) : null}
        {!busy &&
        (hasAction("connect") || hasAction("reauthenticate")) &&
        onConnect ? (
          <TextButton onClick={() => void onConnect(wallet)}>
            <Plug size={14} />
            {hasAction("reauthenticate") ? "Sign in again" : "Connect"}
          </TextButton>
        ) : null}
        {!busy &&
        view === "active" &&
        hasAction("disconnect") &&
        onDisconnect ? (
          <TextButton onClick={() => void onDisconnect(wallet)}>
            <Unplug size={14} />
            Disconnect
          </TextButton>
        ) : null}
        {!busy && hasAction("unlink") && wallet.linkedWalletId && onUnlink ? (
          <IconButton
            danger
            label={`Unlink ${title}`}
            onClick={() => void onUnlink(wallet)}
          >
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </div>
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
  tone: "connected" | "linked" | "active" | "provider";
}) {
  const toneClass =
    tone === "active"
      ? "bg-aomi-success/10 text-aomi-success ring-aomi-success/20 ring-1 ring-inset"
      : tone === "connected"
        ? "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/15 dark:text-sky-300"
        : tone === "provider"
          ? "border-aomi-border text-aomi-muted border"
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
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${danger ? "text-aomi-danger" : "text-aomi-fg"}`}
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
  children: React.ReactNode;
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
      className={`hover:bg-aomi-surface-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${danger ? "text-aomi-danger" : "text-aomi-muted hover:text-aomi-fg"}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
