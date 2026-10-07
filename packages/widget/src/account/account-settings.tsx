"use client";

import { useMemo, useRef, useState } from "react";
import { shortAddress } from "@aomi-labs/client";
import { signOutAndDisconnect } from "@/wallet/account/sign-out";
import { useAomiWalletKit } from "@/wallet/context";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { AccountManagement } from "@/account/account-management/account-management";
import { providerName } from "@/account/account-management/wallet-model";
import {
  providerEmailDisplayHint,
  visibleSignInMethods,
} from "@/wallet/wallet-management-model";
import { useAccountAcl } from "./use-account-acl";
import type { WalletRow } from "@/wallet/composer/wallet-state";

/** Settings › Account is the canonical account, wallet, and signing surface. */
export function AccountSettings({ onClose }: { onClose?: () => void } = {}) {
  const adapter = useAomiWalletKit();
  const acl = useAccountAcl();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  const signInMethods = useMemo(
    () => visibleSignInMethods(adapter.accountLinkedAccounts ?? []),
    [adapter.accountLinkedAccounts],
  );
  const displayEmailHint = adapter.accountUser
    ? providerEmailDisplayHint(
        adapter.identity,
        adapter.accountLinkedAccounts ?? [],
      )
    : undefined;
  const connectionOf = (row: WalletRow) => row.connectionId;

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    refresh = true,
  ): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(key);
    setActionError(null);
    try {
      await action();
      if (refresh) await acl.refresh();
      return true;
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  const disconnect = adapter.disconnect;
  const unlinkWallet = adapter.unlinkLinkedWallet;
  const unlinkLogin = adapter.unlinkLinkedAccount;
  const renameWallet = adapter.updateLinkedWallet;
  const activateWallet = adapter.activateWallet;

  return (
    <div className="flex flex-col">
      <AccountManagement
        user={adapter.accountUser}
        displayEmailHint={displayEmailHint}
        rows={adapter.wallets}
        unlinked={adapter.unlinkedWallet}
        signInMethods={signInMethods}
        pending={pending}
        error={actionError}
        onRenameAccount={
          adapter.updateAccount
            ? async (displayName) => {
                await run("account:rename", () =>
                  adapter.updateAccount!({ displayName: displayName || null }),
                );
              }
            : undefined
        }
        onAddWallet={adapter.openAddWallet}
        onActivate={
          activateWallet
            ? (row) =>
                void run(
                  `activate:${row.key}`,
                  () => activateWallet(row.key),
                  false,
                )
            : undefined
        }
        onVerify={adapter.openVerify}
        onRename={
          renameWallet
            ? (row, label) =>
                run(`rename:${row.key}`, () =>
                  renameWallet({ walletId: row.linkedWalletId!, label }),
                )
            : undefined
        }
        onDisconnect={
          disconnect
            ? (row) => {
                const connectionId = connectionOf(row);
                void run(`disconnect:${row.key}`, () =>
                  disconnect(
                    row.family === "evm" && connectionId
                      ? { accountId: connectionId }
                      : { family: row.family },
                  ),
                );
              }
            : undefined
        }
        onRemove={
          unlinkWallet
            ? async (row) => {
                const confirmed = await confirm({
                  title: "Remove from account?",
                  description: `${shortAddress(row.address)} stops signing you in to this account. The wallet and its funds are not affected.`,
                  confirmLabel: "Remove",
                  tone: "danger",
                });
                if (!confirmed) return;
                await run(`remove:${row.key}`, () =>
                  unlinkWallet(row.linkedWalletId!),
                );
              }
            : undefined
        }
        onSignOutProvider={
          disconnect
            ? (group) => {
                const connectionId = group.rows.map(connectionOf).find(Boolean);
                if (!connectionId) return;
                void run(`provider:${group.key}`, () =>
                  disconnect({
                    accountId: connectionId,
                    providerSignOut: true,
                  }),
                );
              }
            : undefined
        }
        onRemoveLogin={
          unlinkLogin
            ? async (identity, group) => {
                const name = providerName(group.provider);
                const confirmed = await confirm({
                  title: `Remove ${name} from account?`,
                  description: group.rows.length
                    ? `You can no longer sign in with ${name}, and its ${group.rows.length} ${group.rows.length === 1 ? "address is" : "addresses are"} removed too.`
                    : `You can no longer sign in to this account with ${name}.`,
                  confirmLabel: "Remove",
                  tone: "danger",
                });
                if (!confirmed) return;
                await run(`remove-login:${group.key}`, () =>
                  unlinkLogin(identity.id),
                );
              }
            : undefined
        }
        onSignOut={() => {
          // Close first so the panel never renders the signed-out account;
          // errors from the old session have nowhere useful to go.
          onClose?.();
          void signOutAndDisconnect(adapter).catch(() => undefined);
        }}
        onDeleteAccount={
          adapter.deleteAccount
            ? async () => {
                const confirmed = await confirm({
                  title: "Delete this Aomi account?",
                  description:
                    "Linked wallets and sign-in methods will be freed. This can't be undone.",
                  confirmLabel: "Delete account",
                  tone: "danger",
                });
                if (!confirmed) return;
                let deleted = false;
                await run(
                  "account:delete",
                  async () => {
                    await adapter.deleteAccount!();
                    deleted = true;
                    await adapter.disconnect?.({ family: "all" });
                  },
                  false,
                );
                if (deleted) onClose?.();
              }
            : undefined
        }
      />
      {dialog}
    </div>
  );
}
