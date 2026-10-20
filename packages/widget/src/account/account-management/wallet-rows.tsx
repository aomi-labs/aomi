import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  CircleCheck,
  Copy,
  ExternalLink,
  LogOut,
  Mail,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@aomi-labs/react";
import { shortAddress } from "@aomi-labs/client";
import { aomiButton } from "@/ui/aomi/button";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { PendingMark, StatusPill } from "@/ui/aomi/status-pill";
import { explorerUrl } from "@/thread/explorer-links";
import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  CopyButton,
  ExpandToggle,
  rowStart,
  copyText,
  type MenuItem,
} from "./controls";
import {
  appName,
  familyTag,
  pendingHint,
  providerName,
  rowEmail,
  rowTitle,
  type LoginGroup,
} from "./wallet-model";
import { AddressSummary } from "./labels";

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
 * A child row sits a step in from its parent: its logo box starts 16px right
 * of the parent's, which is at 26px ([`rowStart`]).
 */
export const CHILD_INDENT = "pl-[42px]";
const CHILD = CHILD_INDENT;

/**
 * One address. Clicking it makes it Active (or verifies it when it is not in
 * the account yet); a row that needs a step says which on hover. A wallet
 * or login with a single address renders as one of these, passing its own
 * `title` and `menu`.
 */
export function AddressRow({
  row,
  nested = false,
  title: titleNode,
  detail,
  trailing,
  dim = false,
  menu,
  pending,
  onActivate,
  onVerify,
  onRename,
  onDisconnect,
  onRemove,
}: WalletRowHandlers & {
  row: WalletRow;
  nested?: boolean;
  /** Replaces the title line (a single-address wallet shows its own name). */
  title?: ReactNode;
  /** After the address and family, e.g. the app it is used by. */
  detail?: ReactNode;
  /** Before the buttons, e.g. Paused. */
  trailing?: ReactNode;
  /** Greys the mark, e.g. a paused wallet. */
  dim?: boolean;
  /** Rewrites the ⋯ items, e.g. to add a wallet's or login's actions. */
  menu?: (items: MenuItem[]) => MenuItem[];
}) {
  const { rename, dialog } = useRenameDialog();
  const short = shortAddress(row.address);
  const { title, app: titleApp } = rowTitle(row);
  const email = rowEmail(row);
  const hint = pendingHint(row);
  const busy = pending?.endsWith(`:${row.key}`) ?? false;
  const locked = pending !== null;
  const external = !nested;
  const app = appName(row);

  const items: MenuItem[] = [];
  if (row.linked && !row.active && onActivate)
    items.push({
      label: "Make active",
      icon: CircleCheck,
      onSelect: () => onActivate(row),
    });
  if (row.linkedWalletId && onRename)
    items.push({
      label: "Rename",
      icon: Pencil,
      onSelect: () =>
        rename({
          title: "Rename wallet",
          description: `Only you see this name. Leave it empty to show "${app}".`,
          value: row.label ?? "",
          placeholder: app,
          allowEmpty: true,
          onSave: (label) => onRename(row, label || null),
        }),
    });
  items.push({
    label: "Copy address",
    icon: Copy,
    onSelect: () => copyText(row.address),
  });
  const explorer = addressExplorerUrl(row);
  if (explorer)
    items.push({
      label: "View on explorer",
      icon: ExternalLink,
      href: explorer,
    });
  if (
    external &&
    row.actions.some((action) => action.kind === "disconnect") &&
    onDisconnect
  )
    items.push({
      label: "Sign out on this device",
      icon: LogOut,
      onSelect: () => onDisconnect(row),
    });
  if (external && row.linkedWalletId && onRemove)
    items.push({
      label: "Remove from account",
      icon: Trash2,
      danger: true,
      onSelect: () => onRemove(row),
    });

  const click = !row.linked
    ? onVerify
    : row.active || !onActivate
      ? undefined
      : () => onActivate(row);

  const content = (
    <>
      <BrandMark
        brand={app}
        dim={dim}
        dot={dim ? "off" : row.connected || row.kind === "agent" ? "on" : "off"}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        {titleNode ?? (
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
          {short}
          {email ? <span className="font-sans"> · {email}</span> : null} ·{" "}
          {familyTag(row.family)}
          {detail}
        </span>
      </span>
    </>
  );
  const mainClass = cn(
    "flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-2 text-left outline-none",
    nested && CHILD,
  );

  return (
    <div
      data-wallet-row={row.key}
      data-active={row.active || undefined}
      className={cn(
        "group relative flex min-h-14 items-center transition-colors",
        !nested && cn(rowStart(false), "gap-3"),
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
      {click ? (
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
        {trailing ? <span className="mr-1">{trailing}</span> : null}
        {busy || row.activating ? (
          <PendingMark className="mx-2" />
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
          items={menu ? menu(items) : items}
          disabled={locked}
        />
      </div>
      {dialog}
    </div>
  );
}

/**
 * A Para or Privy login. With several addresses it is a parent row that
 * expands to them (open while one is Active); with one, it is that address.
 */
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
  // Open while it holds the active address, until you toggle it yourself.
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? group.rows.some((row) => row.active);
  const name = providerName(group.provider);
  const email = group.identity?.email;
  const signedIn = group.rows.some((row) => row.connected);
  const count = group.rows.length;
  const items: MenuItem[] = [];
  if (email)
    items.push({
      label: "Copy email",
      icon: Mail,
      onSelect: () => copyText(email),
    });
  if (signedIn && onSignOutProvider)
    items.push({
      label: "Sign out on this device",
      icon: LogOut,
      onSelect: () => onSignOutProvider(group),
    });
  if (group.identity && onRemoveLogin) {
    const identity = group.identity;
    items.push({
      label: "Remove from account",
      icon: Trash2,
      danger: true,
      onSelect: () => onRemoveLogin(identity, group),
    });
  }
  const busy =
    handlers.pending === `provider:${group.key}` ||
    handlers.pending === `remove-login:${group.key}`;

  // One address: the address row is the login, with the login's actions.
  const only = count === 1 ? group.rows[0] : undefined;
  if (only)
    return (
      <div data-wallet-provider={group.provider}>
        <AddressRow
          row={only}
          {...handlers}
          menu={(own) => [
            ...own.filter(
              (item) =>
                !item.danger && item.label !== "Sign out on this device",
            ),
            ...items,
          ]}
        />
      </div>
    );

  return (
    <div data-wallet-provider={group.provider}>
      <div
        className={cn(
          "flex min-h-14 items-center gap-3 pr-3",
          rowStart(count > 0),
          count > 0 && "hover:bg-aomi-hover transition-colors",
        )}
      >
        {count > 0 ? (
          <ExpandToggle
            open={open}
            label={`${name} addresses`}
            onToggle={() => setOpen(!open)}
          />
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          disabled={count === 0}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 text-left outline-none disabled:cursor-default"
        >
          <BrandMark brand={group.provider} dot={signedIn ? "on" : "off"} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-row truncate">{name}</span>
            <span className="type-meta text-aomi-muted truncate">
              <AddressSummary families={group.rows.map((row) => row.family)} />
            </span>
          </span>
        </button>
        {items.length ? (
          <ActionsMenu
            label={`Actions for ${name}`}
            items={items}
            disabled={handlers.pending !== null}
            busy={busy}
          />
        ) : null}
      </div>
      {open
        ? group.rows.map((row) => (
            <div key={row.key} className="border-aomi-border border-t">
              <AddressRow row={row} nested {...handlers} />
            </div>
          ))
        : null}
    </div>
  );
}
