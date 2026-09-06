"use client";

import { useState } from "react";
import type { AomiUserRef, LinkedAuthAccount } from "@aomi-labs/widget-lib";
import {
  Check,
  ChevronDown,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { WalletProviderAvatar } from "../wallet-brands";
import { Divider, SettingRow } from "../settings-rows";
import {
  walletConnectionSummary,
  type UnifiedAccountWallet,
} from "../wallet-management-model";
import {
  IconButton,
  OptionGrid,
  SectionHeading,
  StatusBadge,
  TextButton,
  titleCase,
  WalletRow,
} from "./controls";

export type AddWalletOption = {
  id: string;
  family: "evm" | "svm";
  label: string;
  markKey?: string;
  ready: boolean;
};

export type AddSignInOption = {
  id: string;
  label: string;
  ready: boolean;
};

type AccountManagementProps = {
  user?: AomiUserRef;
  wallets: UnifiedAccountWallet[];
  signInMethods: LinkedAuthAccount[];
  addWalletOptions: AddWalletOption[];
  addSignInOptions: AddSignInOption[];
  pending: string | null;
  error?: string | null;
  onRenameAccount?: (displayName: string) => Promise<void>;
  onAddWallet: (option: AddWalletOption) => Promise<void>;
  onAddSignIn: (option: AddSignInOption) => Promise<void>;
  onLinkWallet?: (wallet: UnifiedAccountWallet) => Promise<void>;
  onConnectWallet?: (wallet: UnifiedAccountWallet) => Promise<void>;
  onSelectWallet?: (wallet: UnifiedAccountWallet) => Promise<void>;
  onDisconnectWallet?: (wallet: UnifiedAccountWallet) => Promise<void>;
  onUnlinkWallet?: (wallet: UnifiedAccountWallet) => Promise<void>;
  onUnlinkSignIn?: (account: LinkedAuthAccount) => Promise<void>;
  onSignOut?: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
};

export function AccountManagement({
  user,
  wallets,
  signInMethods,
  addWalletOptions,
  addSignInOptions,
  pending,
  error,
  onRenameAccount,
  onAddWallet,
  onAddSignIn,
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
  const [addWalletOpen, setAddWalletOpen] = useState(false);
  const [addSignInOpen, setAddSignInOpen] = useState(false);
  const visibleName = user?.displayName ?? user?.email ?? "Aomi account";
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
    <div className="flex flex-col gap-6 px-[22px] py-5">
      {error ? (
        <div
          role="alert"
          className="border-aomi-danger/30 bg-aomi-danger/5 text-aomi-danger rounded-lg border px-3 py-2 text-[13px]"
        >
          {error}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <SectionHeading title="Account" />
        <div className="border-aomi-border bg-aomi-bg/40 overflow-hidden rounded-xl border">
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

      <section className="flex flex-col gap-2">
        <SectionHeading
          title="Wallets"
          detail={`${wallets.length} total · ${connectedWalletCount} connected now`}
          action={
            addWalletOptions.length ? (
              <button
                type="button"
                onClick={() => setAddWalletOpen((open) => !open)}
                className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors"
              >
                <Plus size={13} />
                Add wallet
                <ChevronDown
                  size={13}
                  className={`transition-transform ${addWalletOpen ? "rotate-180" : ""}`}
                />
              </button>
            ) : undefined
          }
        />

        {addWalletOpen ? (
          <OptionGrid
            options={addWalletOptions}
            pending={pending}
            prefix="add-wallet"
            onSelect={(option) => void onAddWallet(option)}
          />
        ) : null}

        <div className="border-aomi-border bg-aomi-bg/40 overflow-hidden rounded-xl border">
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
                />
              </div>
            ))
          ) : (
            <p className="text-aomi-muted px-4 py-5 text-[13px]">
              No wallets are connected or linked yet.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeading
          title="Sign-in methods"
          detail={
            signInMethods.length ? `${signInMethods.length} linked` : undefined
          }
          action={
            addSignInOptions.length ? (
              <button
                type="button"
                onClick={() => setAddSignInOpen((open) => !open)}
                className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors"
              >
                <Plus size={13} />
                Add method
              </button>
            ) : undefined
          }
        />

        {addSignInOpen ? (
          <OptionGrid
            options={addSignInOptions}
            pending={pending}
            prefix="add-sign-in"
            onSelect={(option) => void onAddSignIn(option)}
          />
        ) : null}

        <div className="border-aomi-border bg-aomi-bg/40 overflow-hidden rounded-xl border">
          {signInMethods.length ? (
            signInMethods.map((account, index) => (
              <div key={account.id}>
                {index > 0 ? <Divider /> : null}
                <SettingRow
                  className="px-4"
                  leading={
                    <WalletProviderAvatar
                      markKey={account.provider}
                      size={16}
                    />
                  }
                  title={
                    account.displayLabel ??
                    account.email ??
                    titleCase(account.provider)
                  }
                  desc={titleCase(account.provider)}
                >
                  {onUnlinkSignIn ? (
                    <TextButton
                      danger
                      busy={pending === `unlink-identity:${account.id}`}
                      onClick={() => void onUnlinkSignIn(account)}
                    >
                      Unlink
                    </TextButton>
                  ) : (
                    <StatusBadge label="Linked" tone="linked" />
                  )}
                </SettingRow>
              </div>
            ))
          ) : (
            <p className="text-aomi-muted px-4 py-5 text-[13px]">
              Your wallet is currently your only sign-in method.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 pb-1">
        <SectionHeading title="Session" />
        <div className="border-aomi-border bg-aomi-bg/40 overflow-hidden rounded-xl border">
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
