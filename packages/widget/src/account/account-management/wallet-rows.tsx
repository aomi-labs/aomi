import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { shortAddress } from "@aomi-labs/client";
import { aomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { explorerUrl } from "@/thread/explorer-links";
import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  CopyButton,
  copyText,
  type MenuItem,
} from "./controls";
import {
  appName,
  familyTag,
  loginSubtitle,
  pendingHint,
  providerName,
  rowTitle,
  type LoginGroup,
} from "./wallet-model";

type RowHandler = (row: WalletRow) => void;

export type WalletRowHandlers = {
  pending: string | null;
  onActivate?: RowHandler;
  onVerify?: () => void;
  onRename?: (row: WalletRow, label: string | null) => Promise<boolean>;
  onDisconnect?: RowHandler;
  onRemove?: RowHandler;
};

export const addressExplorerUrl = (row: WalletRow) =>
  explorerUrl(
    row.family === "evm" ? (row.chainId ?? 1) : "mainnet-beta",
    "address",
    row.address,
  );

/**
 * One address. Clicking it makes it Active (or verifies it when it is not in
 * the account yet); a row that needs a step says which on hover.
 */
export function AddressRow({
  row,
  nested = false,
  pending,
  onActivate,
  onVerify,
  onRename,
  onDisconnect,
  onRemove,
}: WalletRowHandlers & { row: WalletRow; nested?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const short = shortAddress(row.address);
  const { title, app: titleApp } = rowTitle(row);
  const hint = pendingHint(row);
  const busy = pending?.endsWith(`:${row.key}`) ?? false;
  const locked = pending !== null;
  const external = !nested;
  const app = appName(row);

  const save = async () => {
    if (draft === null || !onRename) return;
    if (await onRename(row, draft.trim() || null)) setDraft(null);
  };

  const items: MenuItem[] = [];
  if (row.linked && !row.active && onActivate)
    items.push({
      label: "Use this wallet",
      detail:
        row.pendingStep === "switch"
          ? `Opens ${app}'s account switch`
          : row.pendingStep === "connect"
            ? `Connects ${app}`
            : undefined,
      onSelect: () => onActivate(row),
    });
  if (row.linkedWalletId && onRename)
    items.push({ label: "Rename", onSelect: () => setDraft(row.label ?? "") });
  items.push({ label: "Copy address", onSelect: () => copyText(row.address) });
  const explorer = addressExplorerUrl(row);
  if (explorer) items.push({ label: "View on explorer", href: explorer });
  const tail: MenuItem[] = [];
  if (
    external &&
    row.actions.some((action) => action.kind === "disconnect") &&
    onDisconnect
  )
    tail.push({
      label: "Disconnect on this device",
      onSelect: () => onDisconnect(row),
    });
  if (external && row.linkedWalletId && onRemove)
    tail.push({
      label: "Remove from account",
      detail: `${short} stops signing you in`,
      danger: true,
      onSelect: () => onRemove(row),
    });
  if (tail.length) items.push("divider", ...tail);

  const click = !row.linked
    ? onVerify
    : row.active || !onActivate
      ? undefined
      : () => onActivate(row);

  const content = (
    <>
      <span className="relative flex shrink-0">
        {nested ? (
          // An L from above into the mark's middle: this address belongs
          // to the login row above it.
          <span
            className="border-aomi-border pointer-events-none absolute -left-2 -top-3 h-7 w-3 rounded-bl-[4px] border-b border-l"
            aria-hidden="true"
          />
        ) : null}
        <BrandMark brand={app} dot={row.connected ? "on" : "off"} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            placeholder={app}
            aria-label={`Name for ${short}`}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") setDraft(null);
            }}
            className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-56 border px-2 outline-none transition-colors"
          />
        ) : (
          <span className="type-row flex min-w-0 items-baseline gap-1.5">
            <span className="truncate">{title}</span>
            {titleApp ? (
              <span className="type-meta text-aomi-muted shrink-0">
                {titleApp}
              </span>
            ) : null}
          </span>
        )}
        <span className="type-address text-aomi-muted truncate">
          {short} · {familyTag(row.family)}
        </span>
      </span>
    </>
  );
  const mainClass = cn(
    "flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-2 text-left outline-none",
    nested ? "pl-10" : "pl-3.5",
  );

  return (
    <div
      data-wallet-row={row.key}
      data-active={row.active || undefined}
      className={cn(
        "group relative flex min-h-14 items-center transition-colors",
        row.active
          ? "bg-aomi-success/[0.045]"
          : click &&
              "hover:bg-aomi-hover has-[:focus-visible]:ring-aomi-accent-strong/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset",
      )}
    >
      {row.active ? (
        <span
          className="bg-aomi-success absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full"
          aria-hidden="true"
        />
      ) : null}
      {click && draft === null ? (
        <button
          type="button"
          aria-label={
            row.linked ? `Use ${title} ${short}` : `Verify ${title} ${short}`
          }
          data-row-main
          disabled={locked}
          onClick={click}
          className={cn(mainClass, "disabled:cursor-default")}
        >
          {content}
        </button>
      ) : (
        <div className={mainClass}>{content}</div>
      )}
      <div className="flex shrink-0 items-center gap-1 pr-3">
        {busy ? (
          <Loader2 className="text-aomi-muted size-3.5 animate-spin" />
        ) : row.active ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : !row.linked && onVerify ? (
          <button
            type="button"
            disabled={locked}
            onClick={onVerify}
            className={aomiButton({ variant: "secondary", size: "sm" })}
          >
            Verify
          </button>
        ) : hint ? (
          <span
            data-hint
            className="type-meta text-aomi-muted pointer-fine:inline-flex pointer-events-none hidden items-center gap-0.5 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-has-[[data-row-main]:focus-visible]:opacity-100"
          >
            {hint}
            <ChevronRight className="size-3" />
          </span>
        ) : null}
        <CopyButton value={row.address} label={`Copy address ${row.address}`} />
        <ActionsMenu
          label={`Actions for ${title} ${short}`}
          items={items}
          disabled={locked}
        />
      </div>
    </div>
  );
}

/** A Para or Privy login, with its addresses nested under it. */
export function LoginRows({
  group,
  onSignOutProvider,
  onRemoveLogin,
  ...handlers
}: WalletRowHandlers & {
  group: LoginGroup;
  onSignOutProvider?: (group: LoginGroup) => void;
  onRemoveLogin?: (identity: LinkedAuthAccount, group: LoginGroup) => void;
}) {
  const name = providerName(group.provider);
  const email = group.identity?.email;
  const subtitle = loginSubtitle(group);
  const signedIn = group.rows.some((row) => row.connected);
  const count = group.rows.length;
  const items: MenuItem[] = [];
  if (signedIn && onSignOutProvider)
    items.push({
      label: `Sign out of ${name} on this device`,
      detail: "Stays in your account",
      onSelect: () => onSignOutProvider(group),
    });
  if (email)
    items.push({ label: "Copy email", onSelect: () => copyText(email) });
  if (group.identity && onRemoveLogin) {
    if (items.length) items.push("divider");
    const identity = group.identity;
    items.push({
      label: `Remove ${name} from account`,
      detail: count
        ? `Its ${count} ${count === 1 ? "address is" : "addresses are"} removed too`
        : undefined,
      danger: true,
      onSelect: () => onRemoveLogin(identity, group),
    });
  }
  const busy =
    handlers.pending === `provider:${group.key}` ||
    handlers.pending === `remove-login:${group.key}`;

  return (
    <div data-wallet-provider={group.provider}>
      <div className="flex min-h-14 items-center gap-3 py-3 pl-3.5 pr-3">
        <BrandMark brand={group.provider} dot={signedIn ? "on" : "off"} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="type-row truncate">{name}</span>
          <span className="type-meta text-aomi-muted truncate">{subtitle}</span>
        </div>
        {items.length ? (
          <ActionsMenu
            label={`Actions for ${name}`}
            items={items}
            disabled={handlers.pending !== null}
            busy={busy}
          />
        ) : null}
      </div>
      {group.rows.map((row) => (
        <div key={row.key} className="border-aomi-border border-t">
          <AddressRow row={row} nested {...handlers} />
        </div>
      ))}
    </div>
  );
}
