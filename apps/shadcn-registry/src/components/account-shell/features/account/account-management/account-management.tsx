"use client";

import { useMemo, useState } from "react";
import type {
  AomiUserRef,
  LinkedAuthAccount,
} from "../../../../../lib/wallet-kit/account/types";
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
import { shortenAddress } from "../account-api";
import { WalletProviderAvatar } from "../wallet-brands";
import {
  Divider,
  SettingRow,
  SettingsSectionHeading,
  settingsPanelClass,
} from "../settings-rows";
import type { ManagedWallet } from "../wallet-management-model";
import {
  IconButton,
  OptionGrid,
  StatusBadge,
  TextButton,
  titleCase,
  WalletRow,
} from "./controls";

export type AddSignInOption = { id: string; label: string; ready: boolean };

type AccountManagementProps = {
  user?: AomiUserRef;
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

const walletProvider = (wallet: ManagedWallet) =>
  titleCase(wallet.provider ?? wallet.walletName ?? wallet.label ?? "Wallet");

export function AccountManagement({
  user,
  wallets,
  signInMethods,
  canAddWallet,
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
  const [accountOpen, setAccountOpen] = useState(true);
  const [addSignInOpen, setAddSignInOpen] = useState(false);
  const [selectingFamily, setSelectingFamily] = useState<"evm" | "svm" | null>(
    null,
  );
  const visibleName = user?.displayName ?? user?.email ?? "Aomi account";
  const linkedWallets = useMemo(
    () => wallets.filter((wallet) => wallet.linked),
    [wallets],
  );
  const activeWallets = useMemo(
    () => wallets.filter((wallet) => wallet.connected),
    [wallets],
  );
  const selectedWallets = useMemo(
    () => wallets.filter((wallet) => wallet.operating),
    [wallets],
  );
  const selectedWalletFamilies = useMemo(
    () =>
      (["evm", "svm"] as const).map((family) => ({
        family,
        selected: selectedWallets.find((wallet) => wallet.family === family),
        candidates: wallets.filter(
          (wallet) =>
            wallet.family === family &&
            wallet.connected &&
            wallet.linked &&
            (wallet.operating ||
              wallet.actions.some((action) => action.kind === "select")),
        ),
      })),
    [selectedWallets, wallets],
  );
  const unlinkedActiveCount = activeWallets.filter(
    (wallet) => !wallet.linked,
  ).length;
  const accountDetail = [
    `${signInMethods.length} ${signInMethods.length === 1 ? "provider" : "providers"}`,
    `${linkedWallets.length} linked ${linkedWallets.length === 1 ? "wallet" : "wallets"}`,
    unlinkedActiveCount
      ? `${unlinkedActiveCount} active ${unlinkedActiveCount === 1 ? "wallet" : "wallets"} not linked`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

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

      <section className={settingsPanelClass}>
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
          <div className="flex items-center gap-1.5">
            {editingName ? (
              <>
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
              </>
            ) : onRenameAccount ? (
              <IconButton
                label="Edit account"
                onClick={() => {
                  setDisplayName(user?.displayName ?? "");
                  setEditingName(true);
                }}
              >
                <Pencil size={14} />
              </IconButton>
            ) : null}
            <IconButton
              label={accountOpen ? "Collapse account" : "Expand account"}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <ChevronDown
                size={15}
                className={`transition-transform ${accountOpen ? "rotate-180" : ""}`}
              />
            </IconButton>
          </div>
        </SettingRow>

        {accountOpen ? (
          <>
            <Divider />
            <div className="px-4 py-4">
              <SettingsSectionHeading
                title="Providers"
                detail={`${signInMethods.length} ${signInMethods.length === 1 ? "method" : "methods"}`}
                hint="Ways you can sign in to this Aomi account. More than one provider can belong to the same account."
                action={
                  addSignInOptions.length ? (
                    <button
                      type="button"
                      onClick={() => setAddSignInOpen((open) => !open)}
                      className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors"
                    >
                      <Plus size={13} />
                      Add provider
                    </button>
                  ) : undefined
                }
              />
              {addSignInOpen ? (
                <div className="mt-2">
                  <OptionGrid
                    options={addSignInOptions}
                    pending={pending}
                    prefix="add-sign-in"
                    onSelect={(option) => void onAddSignIn(option)}
                  />
                </div>
              ) : null}
              <div className="mt-2">
                {signInMethods.length ? (
                  signInMethods.map((account, index) => (
                    <div key={account.id}>
                      {index > 0 ? <Divider /> : null}
                      <SettingRow
                        leading={
                          <WalletProviderAvatar
                            markKey={account.provider}
                            size={16}
                          />
                        }
                        title={titleCase(account.provider)}
                        desc={account.displayLabel ?? account.email ?? ""}
                      >
                        {onUnlinkSignIn ? (
                          <TextButton
                            danger
                            busy={pending === `unlink-identity:${account.id}`}
                            onClick={() => void onUnlinkSignIn(account)}
                          >
                            Remove
                          </TextButton>
                        ) : null}
                      </SettingRow>
                    </div>
                  ))
                ) : (
                  <p className="text-aomi-muted py-4 text-[13px]">
                    Your wallet is currently your only sign-in method.
                  </p>
                )}
              </div>
            </div>

            <Divider />
            <div className="px-4 py-4">
              <SettingsSectionHeading
                title="Linked wallets"
                detail={`${linkedWallets.length} ${linkedWallets.length === 1 ? "wallet" : "wallets"}`}
                hint="Wallets linked to your Aomi account. They remain linked when you sign out or use another browser."
                action={
                  canAddWallet ? (
                    <button
                      type="button"
                      onClick={onAddWallet}
                      className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors"
                    >
                      <Plus size={13} />
                      Add wallet
                    </button>
                  ) : undefined
                }
              />
              <div className="mt-2">
                {linkedWallets.length ? (
                  linkedWallets.map((wallet, index) => (
                    <div key={wallet.key}>
                      {index > 0 ? <Divider /> : null}
                      <WalletRow
                        view="linked"
                        wallet={wallet}
                        pending={pending}
                        onConnect={onConnectWallet}
                        onUnlink={onUnlinkWallet}
                      />
                    </div>
                  ))
                ) : (
                  <p className="text-aomi-muted py-4 text-[13px]">
                    No wallets are linked yet.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <SettingsSectionHeading
          title="Active wallets"
          detail={`${activeWallets.length} ${activeWallets.length === 1 ? "wallet" : "wallets"}${unlinkedActiveCount ? ` · ${unlinkedActiveCount} not linked` : ""}`}
          hint="Wallets active in this browser right now. An active wallet must also be linked before Aomi can select it."
        />
        <div className={settingsPanelClass}>
          {activeWallets.length ? (
            activeWallets.map((wallet, index) => (
              <div key={wallet.key}>
                {index > 0 ? <Divider /> : null}
                <WalletRow
                  view="active"
                  wallet={wallet}
                  pending={pending}
                  onLink={onLinkWallet}
                  onDisconnect={onDisconnectWallet}
                />
              </div>
            ))
          ) : (
            <p className="text-aomi-muted px-4 py-5 text-[13px]">
              No wallets are active in this browser.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SettingsSectionHeading
          title="Selected wallets"
          detail="One EVM wallet and one Solana wallet"
          hint="The linked, active wallets Aomi uses for new transactions. You can select at most one EVM wallet and one Solana wallet."
        />
        <div className={settingsPanelClass}>
          {selectedWalletFamilies.map(
            ({ family, selected, candidates }, index) => {
              return (
                <div key={family}>
                  {index > 0 ? <Divider /> : null}
                  <SettingRow
                    className="px-4"
                    leading={
                      <span className="bg-aomi-surface-2 text-aomi-fg flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                        {family === "evm" ? "◆" : "S"}
                      </span>
                    }
                    title={family === "evm" ? "Ethereum" : "Solana"}
                    desc=""
                  >
                    <div className="flex items-center gap-3">
                      {selected ? (
                        <div className="hidden items-center gap-1.5 text-left sm:flex">
                          <span className="font-mono text-[12px] font-medium">
                            {shortenAddress(selected.address)}
                          </span>
                          <StatusBadge
                            label={walletProvider(selected)}
                            tone="provider"
                          />
                        </div>
                      ) : (
                        <span className="text-aomi-danger hidden text-[12px] sm:block">
                          No wallet selected
                        </span>
                      )}
                      {candidates.length ? (
                        <TextButton
                          onClick={() =>
                            setSelectingFamily((current) =>
                              current === family ? null : family,
                            )
                          }
                        >
                          {selected ? "Change" : "Choose wallet"}
                        </TextButton>
                      ) : null}
                    </div>
                  </SettingRow>
                  {selectingFamily === family ? (
                    <div className="border-aomi-border bg-aomi-surface-2/20 border-t px-4 py-2">
                      {candidates.map((wallet) => (
                        <button
                          key={wallet.key}
                          type="button"
                          disabled={wallet.operating || pending !== null}
                          onClick={() => {
                            void onSelectWallet?.(wallet);
                            setSelectingFamily(null);
                          }}
                          className="hover:bg-aomi-surface-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left disabled:opacity-50"
                        >
                          <span className="font-mono text-[12px] font-medium">
                            {shortenAddress(wallet.address)}
                          </span>
                          <span className="text-aomi-muted text-[11px]">
                            {walletProvider(wallet)}
                            {wallet.operating ? " · Selected" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            },
          )}
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
