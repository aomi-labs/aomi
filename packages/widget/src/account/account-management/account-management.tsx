"use client";

import type { ReactNode } from "react";
import type { AomiUserRef, LinkedAuthAccount } from "@/wallet/account/types";
import { LogOut, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { AccountAvatar } from "../account-avatar";
import { aomiButton } from "@/ui/aomi/button";
import { ListGroup, ListRow, listGroupClass } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { useRenameDialog } from "@/ui/aomi/rename-dialog";
import { accountDisplayName } from "@/wallet/account-presentation";
import type { WalletRow } from "@/wallet/composer/wallet-state";

import {
  ActionsMenu,
  Divider,
  TextButton,
  copyText,
  type MenuItem,
} from "./controls";
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
  /** The agent wallets band at the bottom (signed-in accounts only). */
  agentWallets?: ReactNode;
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
  agentWallets,
  ...rowHandlers
}: AccountManagementProps) {
  const { rename, dialog } = useRenameDialog();
  const { wallets, logins } = walletSections(rows, unlinked, signInMethods);
  const handlers = { pending, ...rowHandlers };
  const visibleName = accountDisplayName(user, displayEmailHint);
  const walletSummary = addressSummary(rows);
  const accountDetail =
    user?.email && user.email !== visibleName
      ? `${user.email} · ${walletSummary}`
      : walletSummary;

  const profileItems: MenuItem[] = [];
  if (onRenameAccount)
    profileItems.push({
      label: "Rename",
      icon: Pencil,
      onSelect: () =>
        rename({
          title: "Rename account",
          description: "How your account appears in Aomi.",
          value: user?.displayName ?? "",
          placeholder: visibleName,
          maxLength: 64,
          allowEmpty: true,
          onSave: async (name) => {
            await onRenameAccount(name);
          },
        }),
    });
  const email = user?.email;
  if (email)
    profileItems.push({
      label: "Copy email",
      icon: Mail,
      onSelect: () => copyText(email),
    });

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
            title={visibleName}
            description={accountDetail}
            trailing={
              profileItems.length ? (
                <ActionsMenu
                  label="Actions for your account"
                  items={profileItems}
                  disabled={pending !== null}
                  busy={pending === "account:rename"}
                />
              ) : null
            }
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

        {wallets.length || logins.length || agentWallets ? (
          <div className={listGroupClass}>
            <SignsWithStrip
              rows={rows}
              disabled={pending !== null}
              onActivate={rowHandlers.onActivate}
              onAddWallet={onAddWallet}
            />
            {wallets.length || logins.length ? (
              <>
                <Divider
                  title="Sign-in wallets"
                  detail="You sign with these yourself"
                />
                <div className="divide-aomi-border divide-y">
                  {wallets.map((row) => (
                    <AddressRow key={row.key} row={row} {...handlers} />
                  ))}
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
            {agentWallets}
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
      {dialog}
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
