import type { ReactNode } from "react";
import {
  ChevronRight,
  LogOut,
  Mail,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "@aomi-labs/react";
import { shortAddress } from "@aomi-labs/client";
import { aomiButton } from "@/ui/aomi/button";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { PendingMark, StatusPill } from "@/ui/aomi/status-pill";
import type { LinkedAuthAccount } from "@/wallet/account/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ActionsMenu,
  BrandMark,
  CopyButton,
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
import { ExpandableRow } from "./expandable-row";
import { AddressSummary } from "./labels";

type RowHandler = (row: WalletRow) => void;

/** A sign-in wallet's Manage sheet: its name, app and addresses. */
export type ManagedWallet = { name: string; brand: string; rows: WalletRow[] };

export type WalletRowHandlers = {
  pending: string | null;
  onManage?: (wallet: ManagedWallet) => void;
  onActivate?: RowHandler;
  onVerify?: () => void;
  onRename?: (row: WalletRow, label: string | null) => Promise<boolean>;
  onDisconnect?: RowHandler;
  onRemove?: RowHandler;
};

/**
 * A child row sits a step in from its parent: its logo box starts 16px right
 * of the parent's, which is at 22px ([`rowStart`]).
 */
export const CHILD_INDENT = "pl-[38px]";

/**
 * One address. Clicking it makes it Active (or verifies it when it is not in
 * the account yet); a row that needs a step says which on hover. Under a
 * wallet (`nested`) it only copies: the wallet's ⋯ holds the actions. A
 * wallet or login with a single address renders as one of these, passing
 * its own `title` and `menu`.
 */
export function AddressRow({
  row,
  nested = false,
  title: titleNode,
  trailing,
  dim = false,
  menu,
  pending,
  onManage,
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

  // The wallet's own short menu: Manage first; making it active and copying
  // are the row and its copy button, the explorer is in Manage › Receive.
  const items: MenuItem[] = [];
  if (external && row.kind !== "agent" && onManage)
    items.push({
      label: "Manage",
      icon: SlidersHorizontal,
      onSelect: () => onManage({ name: title, brand: app, rows: [row] }),
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
        </span>
      </span>
    </>
  );
  const mainClass = cn(
    "flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-2 text-left outline-none",
    nested && CHILD_INDENT,
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
        {nested ? null : (
          <ActionsMenu
            label={`Actions for ${title} ${short}`}
            items={menu ? menu(items) : items}
            disabled={locked}
          />
        )}
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
  const name = providerName(group.provider);
  const email = group.identity?.email;
  const signedIn = group.rows.some((row) => row.connected);
  const items: MenuItem[] = [];
  if (handlers.onManage)
    items.push({
      label: "Manage",
      icon: SlidersHorizontal,
      onSelect: () =>
        handlers.onManage?.({ name, brand: name, rows: group.rows }),
    });
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
  const only = group.rows.length === 1 ? group.rows[0] : undefined;
  if (only)
    return (
      <div data-wallet-provider={group.provider}>
        <AddressRow
          row={only}
          {...handlers}
          menu={(own) => [
            // The login's own items replace the row's Manage and Sign out.
            ...own.filter(
              (item) =>
                !item.danger &&
                item.label !== "Manage" &&
                item.label !== "Sign out on this device",
            ),
            ...items,
          ]}
        />
      </div>
    );

  return (
    <div data-wallet-provider={group.provider}>
      <ExpandableRow
        label={`${name} addresses`}
        defaultOpen={group.rows.some((row) => row.active)}
        leading={
          <BrandMark brand={group.provider} dot={signedIn ? "on" : "off"} />
        }
        title={name}
        description={
          <AddressSummary families={group.rows.map((row) => row.family)} />
        }
        trailing={
          items.length ? (
            <ActionsMenu
              label={`Actions for ${name}`}
              items={items}
              disabled={handlers.pending !== null}
              busy={busy}
            />
          ) : null
        }
      >
        {group.rows.map((row) => (
          <AddressRow key={row.key} row={row} nested {...handlers} />
        ))}
      </ExpandableRow>
    </div>
  );
}
