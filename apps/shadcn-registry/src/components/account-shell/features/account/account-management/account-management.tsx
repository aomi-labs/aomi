"use client";

import { useState } from "react";
import type {
  AomiUserRef,
  LinkedAuthAccount,
} from "../../../../../lib/wallet-kit/account/types";
import {
  Check,
  LogOut,
  UserRoundMinus,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { WalletProviderAvatar } from "../wallet-brands";
import {
  Divider,
  SettingRow,
  SettingsSectionHeading,
  settingsPanelClass,
} from "../settings-rows";
import {
  accountDisplayName,
  walletConnectionSummary,
  type ManagedWallet,
} from "../wallet-management-model";

import {
  IconButton,
  StatusBadge,
  TextButton,
  titleCase,
  WalletRow,
  WalletActionsMenu,
} from "./controls";

export type AddSignInOption = {
  id: string;
  label: string;
  ready: boolean;
};

type AccountManagementProps = {
  user?: AomiUserRef;
  /** Session-derived presentation hint; never persisted as account email. */
  displayEmailHint?: string;
  wallets: ManagedWallet[];
  signInMethods: LinkedAuthAccount[];
  canAddWallet: boolean;
  addSignInOptions: AddSignInOption[];
  pending: string | null;
  error?: string | null;
  onRenameAccount?: (displayName: string) => Promise<void>;
  onAddWallet: () => void;
  onAddSignIn: (option: AddSignInOption) => Promise<void>;
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
  const identityWallets = new Map<string, string>();
  for (const account of signInMethods) {
    if (account.provider !== "privy" && account.provider !== "para") continue;
    const wallet = wallets.find(
      (wallet) =>
        wallet.provider === account.provider &&
        (wallet.linked || wallet.kind === "embedded"),
    );
    if (wallet) identityWallets.set(account.id, wallet.key);
  }
  const separateIdentities = signInMethods.filter(
    (account) => !identityWallets.has(account.id),
  );
  const visibleName = accountDisplayName(user, displayEmailHint);
  const connectedWalletCount = wallets.filter(
    (wallet) => wallet.connected,
  ).length;
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

  return (
    <div className="mx-auto flex w-full max-w-[780px] flex-col gap-5 px-6 py-6">
      {error ? (
        <div
          role="alert"
          className="border-aomi-danger/30 bg-aomi-danger/5 text-aomi-danger rounded-lg border px-3 py-2 text-[13px]"
        >
          {error}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <SettingsSectionHeading title="Account" />
        <div className={settingsPanelClass}>
          <SettingRow
            className="px-4"
            leading={
              <span className="bg-aomi-surface-2 text-aomi-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <UserRound size={16} />
              </span>
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
                  className="border-aomi-border bg-aomi-bg text-aomi-fg focus:border-aomi-muted h-7 w-full max-w-64 rounded-md border px-2 text-sm font-medium outline-none transition-colors"
                />
              ) : (
                visibleName
              )
            }
            desc={accountDetail}
          >
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <IconButton
                  label="Save account name"
                  busy={pending === "account:rename"}
                  onClick={() => void saveName()}
                >
                  <Check size={14} />
                </IconButton>
                <IconButton
                  label="Cancel account name edit"
                  disabled={pending === "account:rename"}
                  onClick={cancelNameEdit}
                >
                  <X size={14} />
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
                <Pencil size={14} />
              </IconButton>
            ) : null}
          </SettingRow>
        </div>
      </section>

      <section className="flex flex-col gap-2 [&_h3]:shrink-0">
        <SettingsSectionHeading
          title="Wallets & access"
          className="flex-wrap sm:flex-nowrap"
          hint="Connected: available on this device. Linked: saved to your Aomi account and usable for sign-in. Active: selected for use with Aomi, one per family (EVM and SVM). Click an eligible wallet to make it active. Disconnect only ends the device connection; unlink removes account access without deleting the wallet or its funds."
          detail={`${wallets.length} total · ${connectedWalletCount} connected now`}
          action={
            canAddWallet ? (
              <button
                type="button"
                onClick={onAddWallet}
                className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[11px] font-medium transition-colors"
              >
                <Plus size={13} />
                Add more
              </button>
            ) : undefined
          }
        />

        <div className={settingsPanelClass}>
          {wallets.length ? (
            wallets.map((wallet, index) => (
              <div key={wallet.key}>
                {index > 0 ? <Divider /> : null}
                <WalletRow
                  wallet={wallet}
                  pending={pending}
                  onLink={onLinkWallet}
                  onConnect={onConnectWallet}
                  onSelect={onSelectWallet}
                  onDisconnect={onDisconnectWallet}
                  onUnlink={onUnlinkWallet}
                  signInMethods={signInMethods.filter(
                    (account) => identityWallets.get(account.id) === wallet.key,
                  )}
                  onUnlinkSignIn={onUnlinkSignIn}
                />
              </div>
            ))
          ) : !separateIdentities.length ? (
            <p className="text-aomi-muted px-4 py-5 text-[13px]">
              No wallets are connected or linked yet.
            </p>
          ) : null}
          {separateIdentities.map((account, index) => (
            <div key={account.id}>
              {wallets.length > 0 || index > 0 ? <Divider /> : null}
              <SettingRow
                className="px-4"
                leading={
                  <WalletProviderAvatar markKey={account.provider} size={16} />
                }
                title={titleCase(account.provider)}
                desc={
                  account.displayLabel ?? account.email ?? "Account sign-in"
                }
              >
                <div className="flex items-center gap-2">
                  <StatusBadge label="Linked" tone="linked" />
                  {onUnlinkSignIn ? (
                    <WalletActionsMenu
                      label={`Actions for ${titleCase(account.provider)} sign-in`}
                      disabled={pending !== null}
                      busy={pending === `unlink-identity:${account.id}`}
                      actions={[
                        {
                          label: `Unlink ${titleCase(account.provider)} sign-in`,
                          icon: <UserRoundMinus size={15} />,
                          onSelect: () => void onUnlinkSignIn(account),
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </SettingRow>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 pb-1">
        <SettingsSectionHeading title="Session" />
        <div className={settingsPanelClass}>
          {onSignOut ? (
            <SettingRow
              className="px-4"
              leading={
                <span className="bg-aomi-surface-2 text-aomi-muted flex h-8 w-8 items-center justify-center rounded-full">
                  <LogOut size={15} />
                </span>
              }
              title="Sign out"
              desc="End this account session on this device"
            >
              <TextButton
                busy={pending === "account:signout"}
                onClick={() => void onSignOut()}
              >
                Sign out
              </TextButton>
            </SettingRow>
          ) : null}
          {onSignOut && onDeleteAccount ? <Divider /> : null}
          {onDeleteAccount ? (
            <SettingRow
              className="px-4"
              leading={
                <span className="bg-aomi-danger/10 text-aomi-danger flex h-8 w-8 items-center justify-center rounded-full">
                  <Trash2 size={15} />
                </span>
              }
              title="Delete account"
              desc="Permanently remove the account and free linked access"
            >
              <TextButton
                danger
                busy={pending === "account:delete"}
                onClick={() => void onDeleteAccount()}
              >
                Delete
              </TextButton>
            </SettingRow>
          ) : null}
        </div>
      </section>
    </div>
  );
}
