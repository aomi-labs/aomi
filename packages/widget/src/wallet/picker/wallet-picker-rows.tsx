"use client";

import type { FC, SVGProps } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  LinkIcon,
  Loader2Icon,
  LogOutIcon,
  MailIcon,
  Settings2Icon,
} from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import { formatWalletAddress } from "@/wallet/identity";
import type { AomiWalletKit, WalletFamily } from "@/wallet/types";
import type { WalletAction as WalletRowAction } from "@/wallet/composer/wallet-state";
import { WalletIconSlot } from "@/wallet/wallet-icon-slot";
import {
  familyLabel,
  providerBackedAccountProvider,
  providerBackedWalletTitle,
  type WalletModalRow,
} from "./wallet-account-model";
import { walletStatusLabel, type WalletAction } from "./wallet-options";

export type SupportedEvmChain = { id: number; name: string };
export type ConnectedActionRef = {
  action: WalletRowAction;
  account: WalletModalRow;
};

export function SectionLabel({ children }: { children: string }) {
  return (
    <span className="text-aomi-muted px-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]">
      {children}
    </span>
  );
}

export function ChainTag({
  family,
  capability,
}: {
  family: WalletFamily;
  capability?: "read" | "write";
}) {
  const isSolana = family === "svm";
  const dotColor = capability === "read" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span
      className="text-muted-foreground/70 inline-flex min-w-0 shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
      title={isSolana ? "Solana (SVM)" : "Ethereum-compatible wallet"}
      data-wallet-access={capability === "read" ? "stored" : "connected"}
    >
      <span className={cn("size-1.5 rounded-full", dotColor)} />
      <span className="max-w-20 truncate">{isSolana ? "SVM" : "EVM"}</span>
    </span>
  );
}

export function networkNameForChain(
  chainId: number | undefined,
  supportedEvmChains?: readonly SupportedEvmChain[],
): string | null {
  if (!chainId) return null;
  const configured = supportedEvmChains?.find((chain) => chain.id === chainId);
  if (configured) return configured.name;
  return supportedEvmChains && supportedEvmChains.length > 0
    ? null
    : (getChainInfo(chainId)?.name ?? null);
}

export function FinishSignInPanel({
  account,
  identity,
  supportedEvmChains,
  pending,
  linkAction,
  onLink,
  canDisconnect,
  onDisconnect,
}: {
  account: WalletModalRow;
  identity: AomiWalletKit["identity"];
  supportedEvmChains: readonly SupportedEvmChain[];
  pending: string | null;
  linkAction?: WalletModalRow["actions"][number];
  onLink: (ref: ConnectedActionRef) => void;
  canDisconnect: boolean;
  onDisconnect: () => void;
}) {
  const provider = providerBackedAccountProvider(account);
  const title = providerBackedWalletTitle(account);
  const network =
    account.family === "evm"
      ? (networkNameForChain(account.chainId, supportedEvmChains) ??
        networkNameForChain(identity.chainId, supportedEvmChains) ??
        "Ethereum")
      : "Solana";
  const rowId = account.connectionId ?? account.key;
  const actionKey = linkAction ? `${linkAction.kind}:${rowId}` : undefined;
  const busy = actionKey != null && pending === actionKey;

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Connected wallet</SectionLabel>
      <div className="border-aomi-border bg-aomi-bg/20 overflow-hidden rounded-[14px] border">
        <div className="flex items-center gap-3 px-3 py-3">
          <WalletIconSlot
            id={provider ?? rowId}
            label={title}
            provider={provider ?? account.provider}
            className="!bg-transparent"
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-semibold">
                {title}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            </span>
            <span className="text-aomi-muted mt-0.5 block truncate text-xs">
              {[formatWalletAddress(account.address ?? ""), network]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {canDisconnect ? (
            <RowIconButton
              icon={LogOutIcon}
              ariaLabel={`Disconnect ${familyLabel(account.family)} wallet`}
              disabled={pending !== null}
              loading={pending === `disconnect:${rowId}`}
              onClick={onDisconnect}
            />
          ) : null}
        </div>
        <div className="border-aomi-border border-t p-2.5">
          <button
            type="button"
            disabled={!linkAction || pending !== null}
            onClick={() =>
              linkAction && onLink({ action: linkAction, account })
            }
            className="bg-aomi-fg text-aomi-bg flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy || !linkAction ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            Link wallet and sign in
          </button>
          <p className="text-aomi-muted mt-2 px-1 text-[10px] leading-snug">
            You’ll sign a message to prove this wallet is yours. No transaction
            is sent.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ConnectedWalletRow({
  title,
  iconId,
  iconLabel,
  iconProvider,
  family,
  capability,
  addressText,
  detail,
  active,
  selectKey,
  pending,
  onSelect,
  actions,
  onAction,
}: {
  title: string;
  iconId: string;
  iconLabel: string;
  iconProvider?: string;
  family: WalletFamily;
  capability?: "read" | "write";
  addressText: string;
  detail?: string;
  active: boolean;
  selectKey?: string;
  pending: string | null;
  onSelect?: () => void;
  actions: readonly ConnectedActionRef[];
  onAction: (ref: ConnectedActionRef) => void;
}) {
  const selectable = Boolean(onSelect);
  const isSelecting = selectKey != null && pending === selectKey;

  const inner = (
    <>
      <WalletIconSlot
        id={iconId}
        label={iconLabel}
        provider={iconProvider}
        className="!bg-transparent"
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{title}</span>
          <ChainTag family={family} capability={capability} />
          {active ? (
            <CheckIcon className="text-primary size-3.5 shrink-0" />
          ) : null}
        </span>
        <span className="text-muted-foreground block truncate text-[11px]">
          {[addressText, detail].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-center transition-colors duration-200",
        active ? "bg-emerald-500/[0.045]" : "bg-aomi-bg/25",
        selectable && "hover:bg-aomi-hover has-[:focus-visible]:bg-aomi-hover",
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          disabled={pending !== null}
          aria-label={`Make ${title} active`}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none",
            "disabled:cursor-default",
          )}
        >
          {inner}
          {isSelecting ? (
            <span className="ml-1 flex shrink-0 items-center">
              <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
            </span>
          ) : null}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
          {inner}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 py-3 pl-1 pr-3">
        {actions.map(({ action, account }) =>
          action.kind === "link" ? (
            <button
              key={`${action.kind}:${account.connectionId ?? account.key}`}
              type="button"
              disabled={pending !== null}
              onClick={() => onAction({ action, account })}
              className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50"
            >
              {pending ===
              `${action.kind}:${account.connectionId ?? account.key}` ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <LinkIcon className="size-3.5" />
              )}
              Link wallet
            </button>
          ) : (
            <RowIconButton
              key={`${action.kind}:${account.connectionId ?? account.key}`}
              icon={action.kind === "manage" ? Settings2Icon : LogOutIcon}
              ariaLabel={
                action.kind === "manage"
                  ? `Manage ${title}`
                  : action.kind === "signout"
                    ? "Sign out"
                    : `Disconnect ${familyLabel(account.family)} wallet`
              }
              disabled={pending !== null}
              loading={
                pending ===
                `${action.kind}:${account.connectionId ?? account.key}`
              }
              onClick={() => onAction({ action, account })}
            />
          ),
        )}
      </div>
    </div>
  );
}

export function WalletActionRow({
  wallet,
  pending,
  linkedMode,
  onClick,
}: {
  wallet: WalletAction;
  pending: string | null;
  linkedMode: boolean;
  onClick: () => void;
}) {
  const disabled = wallet.ready === false || pending !== null;
  const showStatus = wallet.status === "unavailable";
  const actionVerb = linkedMode ? "Link" : "Connect";
  const description =
    wallet.description ??
    (wallet.family === "svm"
      ? `${actionVerb} a Solana wallet`
      : `${actionVerb} an Ethereum wallet`);
  const visibleDescription = linkedMode
    ? description.replace(/^Connect /, "Link ")
    : description;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${actionVerb} ${wallet.label}`}
      className={cn(
        "bg-aomi-bg/20 hover:bg-aomi-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <WalletIconSlot
        iconUrl={wallet.iconUrl}
        id={wallet.id}
        label={wallet.label}
        className="!bg-transparent"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {wallet.label}
        </span>
        <span className="text-aomi-muted block truncate text-[11px]">
          {visibleDescription}
        </span>
      </span>
      {showStatus ? (
        <span className="bg-aomi-surface-2 text-aomi-muted shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
          {walletStatusLabel(wallet)}
        </span>
      ) : null}
      {pending === wallet.actionKey ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon className="text-aomi-muted size-3.5 shrink-0" />
      )}
    </button>
  );
}

export function SocialLoginRow({
  option,
  pending,
  brandLabel,
  onClick,
}: {
  option: WalletAction;
  pending: string | null;
  /** Account-provider brand (e.g. "Para") shown as the row title, with the
   * sign-in method ("Email or Google") beneath it. Falls back to the method
   * label + mail icon when the provider has no brand. */
  brandLabel?: string;
  onClick: () => void;
}) {
  const title = brandLabel ?? option.label;
  const subtitle =
    brandLabel && brandLabel !== option.label
      ? option.label
      : (option.description ?? "Use an Aomi account");
  return (
    <button
      onMouseEnter={option.preload}
      onFocus={option.preload}
      type="button"
      disabled={pending !== null || option.ready === false}
      onClick={onClick}
      aria-label={option.label}
      className={cn(
        "bg-aomi-bg/20 hover:bg-aomi-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {brandLabel ? (
        <WalletIconSlot
          id={brandLabel}
          label={brandLabel}
          className="!bg-transparent"
        />
      ) : (
        <span className="text-aomi-muted flex size-9 shrink-0 items-center justify-center">
          <MailIcon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="text-aomi-muted block truncate text-[11px]">
          {subtitle}
        </span>
      </span>
      {pending === `social:${option.id}` ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon className="text-aomi-muted size-3.5 shrink-0" />
      )}
    </button>
  );
}

export function RowIconButton({
  icon: Icon,
  onClick,
  disabled,
  loading,
  ariaLabel,
}: {
  icon: FC<SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      className={cn(
        "rounded-full p-1.5 transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {loading ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </button>
  );
}
