"use client";

import { useState, type ReactNode } from "react";
import type {
  AomiUserRef,
  LinkedAuthAccount,
} from "../../../../../lib/wallet-kit/account/types";
import {
  Check,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { aomiButton } from "../../../../ui/aomi/button";
import { ListGroup, ListRow } from "../../../../ui/aomi/list-group";
import { SectionHeader } from "../../../../ui/aomi/section-header";
import {
  accountDisplayName,
  walletConnectionSummary,
  type ManagedWallet,
} from "../wallet-management-model";

import {
  ExternalWalletCard,
  IconButton,
  ProviderWalletCard,
  TextButton,
} from "./controls";
import { groupWallets } from "./wallet-groups";

type AccountManagementProps = {
  user?: AomiUserRef;
  /** Session-derived presentation hint; never persisted as account email. */
  displayEmailHint?: string;
  wallets: ManagedWallet[];
  signInMethods: LinkedAuthAccount[];
  canAddWallet: boolean;
  pending: string | null;
  error?: string | null;
  onRenameAccount?: (displayName: string) => Promise<void>;
  onAddWallet: () => void;
  onLinkWallet?: (wallet: ManagedWallet) => Promise<void>;
  onConnectWallet?: (wallet: ManagedWallet) => Promise<void>;
  onSelectWallet?: (wallet: ManagedWallet) => Promise<void>;
  onDisconnectWallet?: (wallet: ManagedWallet) => Promise<void>;
  onUnlinkWallet?: (wallet: ManagedWallet) => Promise<void>;
  onUnlinkSignIn?: (account: LinkedAuthAccount) => Promise<void>;
  onSignOut?: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
};

export function AccountManagement({
  user,
  displayEmailHint,
  wallets,
  signInMethods,
  canAddWallet,
  pending,
  error,
  onRenameAccount,
  onAddWallet,
  onLinkWallet,
  onConnectWallet,
  onSelectWallet,
  onDisconnectWallet,
  onUnlinkWallet,
  onUnlinkSignIn,
  onSignOut,
  onDeleteAccount,
}: AccountManagementProps) {
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const groups = groupWallets(wallets, signInMethods);
  const lineHandlers = {
    pending,
    onLink: onLinkWallet,
    onConnect: onConnectWallet,
    onSelect: onSelectWallet,
    onDisconnect: onDisconnectWallet,
    onUnlink: onUnlinkWallet,
  };
  const visibleName = accountDisplayName(user, displayEmailHint);
  const onDevice = wallets.filter((wallet) => wallet.connected).length;
  const walletSummary = walletConnectionSummary(wallets);
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
            leading={
              <RowIcon>
                <UserRound className="size-4" />
              </RowIcon>
            }
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
          help="Each address can be active for its family: one EVM and one SVM at a time. Click an address to make it active; a status appears only when an address needs attention, such as one that is not on this device or not yet saved to your account."
          detail={`${wallets.length} ${
            wallets.length === 1 ? "address" : "addresses"
          } · ${onDevice} on this device`}
          action={
            canAddWallet ? (
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

        {groups.length ? (
          <ListGroup>
            {groups.map((group) =>
              group.kind === "provider" ? (
                <ProviderWalletCard
                  key={group.key}
                  provider={group.provider}
                  identity={group.identity}
                  wallets={group.wallets}
                  onUnlinkSignIn={onUnlinkSignIn}
                  {...lineHandlers}
                />
              ) : (
                <ExternalWalletCard
                  key={group.key}
                  wallet={group.wallet}
                  {...lineHandlers}
                />
              ),
            )}
          </ListGroup>
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
                trailing={
                  <TextButton
                    busy={pending === "account:signout"}
                    onClick={() => void onSignOut()}
                  >
                    Sign out
                  </TextButton>
                }
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
