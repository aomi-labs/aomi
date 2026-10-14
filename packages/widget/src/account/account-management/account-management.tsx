"use client";

import { useState, type ReactNode } from "react";
import type { AomiUserRef, LinkedAuthAccount } from "@/wallet/account/types";
import { Check, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { AccountAvatar } from "../account-avatar";
import { aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow, listGroupClass } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { accountDisplayName } from "@/wallet/wallet-management-model";
import type { WalletRow } from "@/wallet/composer/wallet-state";

import { IconButton, TextButton } from "./controls";
import { SignsWithStrip } from "./signs-with";
import { AddressRow, LoginRows, type WalletRowHandlers } from "./wallet-rows";
import {
  addressSummary,
  walletSections,
  type LoginGroup,
} from "./wallet-model";

type AccountManagementProps = Omit<WalletRowHandlers, "pending"> & {
  user?: AomiUserRef;
  /** Session-derived presentation hint; never persisted as account email. */
  displayEmailHint?: string;
  rows: readonly WalletRow[];
  /** A connected address that is not in the account yet. */
  unlinked?: WalletRow;
  signInMethods: readonly LinkedAuthAccount[];
  pending: string | null;
  error?: string | null;
  onRenameAccount?: (displayName: string) => Promise<void>;
  onAddWallet?: () => void;
  onSignOutProvider?: (group: LoginGroup) => void;
  onRemoveLogin?: (identity: LinkedAuthAccount, group: LoginGroup) => void;
  onSignOut?: () => void;
  onDeleteAccount?: () => Promise<void>;
};

export function AccountManagement({
  user,
  displayEmailHint,
  rows,
  unlinked,
  signInMethods,
  pending,
  error,
  onRenameAccount,
  onAddWallet,
  onSignOutProvider,
  onRemoveLogin,
  onSignOut,
  onDeleteAccount,
  ...rowHandlers
}: AccountManagementProps) {
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const { wallets, logins } = walletSections(rows, unlinked, signInMethods);
  const handlers = { pending, ...rowHandlers };
  const visibleName = accountDisplayName(user, displayEmailHint);
  const walletSummary = addressSummary(rows);
  const accountDetail =
    user?.email && user.email !== visibleName
      ? `${user.email} · ${walletSummary}`
      : walletSummary;

  const saveName = async () => {
    if (!onRenameAccount) return;
    await onRenameAccount(displayName.trim());
    setEditingName(false);
  };

  const cancelNameEdit = () => {
    setDisplayName(user?.displayName ?? "");
    setEditingName(false);
  };

  const renameActions = editingName ? (
    <div className="flex items-center gap-1.5">
      <IconButton
        label="Save account name"
        busy={pending === "account:rename"}
        onClick={() => void saveName()}
      >
        <Check />
      </IconButton>
      <IconButton
        label="Cancel account name edit"
        disabled={pending === "account:rename"}
        onClick={cancelNameEdit}
      >
        <X />
      </IconButton>
    </div>
  ) : onRenameAccount ? (
    <IconButton
      label="Rename account"
      onClick={() => {
        setDisplayName(user?.displayName ?? "");
        setEditingName(true);
      }}
    >
      <Pencil />
    </IconButton>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div
          role="alert"
          className="border-aomi-danger/30 bg-aomi-danger/5 text-aomi-danger rounded-control type-control border px-3 py-2"
        >
          {error}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <SectionHeader title="Profile" detail="How your account appears" />
        <ListGroup>
          <ListRow
            leading={<AccountAvatar seed={user?.id} size={32} />}
            title={
              editingName ? (
                <input
                  autoFocus
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveName();
                    if (event.key === "Escape") cancelNameEdit();
                  }}
                  aria-label="Account display name"
                  disabled={pending === "account:rename"}
                  className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted type-row rounded-control h-7 w-full max-w-64 border px-2 outline-none transition-colors"
                />
              ) : (
                visibleName
              )
            }
            description={accountDetail}
            trailing={renameActions}
          />
        </ListGroup>
      </section>

      <section className="flex flex-col gap-2 [&_h3]:shrink-0">
        <SectionHeader
          title="Wallets & access"
          className="flex-wrap sm:flex-nowrap"
          detail={walletSummary}
          action={
            onAddWallet ? (
              <button
                type="button"
                onClick={onAddWallet}
                className={aomiButton({ variant: "secondary", size: "sm" })}
              >
                <Plus />
                Add a wallet
              </button>
            ) : undefined
          }
        />

        {wallets.length || logins.length ? (
          <div className={listGroupClass}>
            <SignsWithStrip
              rows={rows}
              disabled={pending !== null}
              onActivate={rowHandlers.onActivate}
              onAddWallet={onAddWallet}
            />
            {wallets.length ? (
              <>
                <Divider
                  title="Wallets"
                  detail="Sign in by signing a message"
                />
                <div className="divide-aomi-border divide-y">
                  {wallets.map((row) => (
                    <AddressRow key={row.key} row={row} {...handlers} />
                  ))}
                </div>
              </>
            ) : null}
            {logins.length ? (
              <>
                <Divider
                  title="Social sign-in"
                  detail="Privy and Para logins, with their wallets"
                />
                <div className="divide-aomi-border divide-y">
                  {logins.map((group) => (
                    <LoginRows
                      key={group.key}
                      group={group}
                      onSignOutProvider={onSignOutProvider}
                      onRemoveLogin={onRemoveLogin}
                      {...handlers}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <ListGroup>
            <p className="type-control text-aomi-muted px-3.5 py-4">
              No wallets are connected or linked yet.
            </p>
          </ListGroup>
        )}
      </section>

      {onSignOut || onDeleteAccount ? (
        <section className="flex flex-col gap-2">
          <SectionHeader title="Session" detail="This device" />
          <ListGroup>
            {onSignOut ? (
              <ListRow
                leading={
                  <RowIcon>
                    <LogOut className="size-4" />
                  </RowIcon>
                }
                title="Sign out"
                description="End this account session on this device"
                trailing={<TextButton onClick={onSignOut}>Sign out</TextButton>}
              />
            ) : null}
            {onDeleteAccount ? (
              <ListRow
                leading={
                  <RowIcon danger>
                    <Trash2 className="size-4" />
                  </RowIcon>
                }
                title="Delete account"
                description="Permanently remove the account and free linked access"
                trailing={
                  <TextButton
                    danger
                    busy={pending === "account:delete"}
                    onClick={() => void onDeleteAccount()}
                  >
                    Delete
                  </TextButton>
                }
              />
            ) : null}
          </ListGroup>
        </section>
      ) : null}
    </div>
  );
}

/** A section band inside the wallets card. */
function Divider({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-aomi-border bg-aomi-surface-2/60 flex items-baseline gap-2 border-y px-3.5 py-1.5 first:border-t-0">
      <span className="type-meta text-aomi-fg font-medium">{title}</span>
      <span className="type-meta text-aomi-muted truncate">{detail}</span>
    </div>
  );
}

function RowIcon({
  danger = false,
  children,
}: {
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
        danger
          ? "bg-aomi-danger/10 text-aomi-danger"
          : "bg-aomi-surface-2 text-aomi-muted"
      }`}
    >
      {children}
    </span>
  );
}
