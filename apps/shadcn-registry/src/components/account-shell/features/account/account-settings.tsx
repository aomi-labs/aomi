"use client";

import { useContext, useMemo, useState } from "react";
import { signOutAndDisconnect } from "../../../../lib/wallet-kit/account/sign-out";
import { useAomiWalletKit } from "../../../../lib/wallet-kit/context";
import {
  requestWalletPickerOpen,
  WalletSignInOptionsContext,
} from "../../../control-bar/wallet-picker-context";
import { AccountManagement, type AddSignInOption } from "./account-management";
import { useAccountAcl } from "./use-account-acl";
import {
  providerEmailDisplayHint,
  visibleSignInMethods,
  type ManagedWallet,
} from "./wallet-management-model";
import { walletKey } from "../../../../lib/wallet-kit/wallet-utils";
import { resolveWalletBrandKey } from "./wallet-brands";

/** Settings › Account is the canonical account, wallet, and signing surface. */
export function AccountSettings({ onClose }: { onClose?: () => void } = {}) {
  const adapter = useAomiWalletKit();
  const providerOptions = useContext(WalletSignInOptionsContext);
  const acl = useAccountAcl();
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const wallets = useMemo(
    () =>
      adapter.wallets.map(
        (wallet): ManagedWallet => ({
          ...wallet,
          policy: acl.wallets.find(
            (policy) => walletKey(policy.chain, policy.address) === wallet.key,
          ),
        }),
      ),
    [acl.wallets, adapter.wallets],
  );
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
  const addSignInOptions = useMemo<AddSignInOption[]>(
    () =>
      (providerOptions.length
        ? providerOptions
        : (adapter.socialLoginOptions ?? [])
      ).map((option) => ({
        id: option.id,
        label: option.label,
        ready: option.status !== "unavailable",
      })),
    [adapter.socialLoginOptions, providerOptions],
  );

  const run = async (
    key: string,
    action: () => Promise<void>,
    refresh = true,
  ): Promise<boolean> => {
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
      setPending(null);
    }
  };

  const linkWallet = async (wallet: ManagedWallet) => {
    if (!wallet.connectionId) return;
    await run(`link:${wallet.key}`, async () => {
      if (adapter.linkWallet) {
        await adapter.linkWallet({
          accountId: wallet.connectionId,
          family: wallet.family,
          address: wallet.address,
          chainId: wallet.chainId,
        });
        return;
      }
      await acl.bindWallet({
        id: wallet.key,
        chain: wallet.family,
        address: wallet.address,
        walletName: wallet.walletName,
        provider: wallet.provider,
        active: wallet.operating,
      });
    });
  };

  const unlinkWallet = async (wallet: ManagedWallet) => {
    if (!adapter.unlinkLinkedWallet || !wallet.linkedWalletId) return;
    if (!window.confirm(`Unlink ${wallet.address} from this account?`)) return;
    await run(`unlink:${wallet.key}`, () =>
      adapter.unlinkLinkedWallet!(wallet.linkedWalletId!),
    );
  };

  const connectWallet = async (wallet: ManagedWallet) => {
    await run(`connect:${wallet.key}`, async () => {
      const provider = wallet.provider?.toLowerCase();
      if (
        wallet.kind === "embedded" &&
        (provider === "para" || provider === "privy")
      ) {
        const option = providerOptions.find((option) => option.id === provider);
        if (option) {
          await option.connect();
          return;
        }
        if (
          adapter.identity.embeddedProvider === provider &&
          adapter.connectSocial
        ) {
          await adapter.connectSocial(provider);
          return;
        }
        throw new Error(
          `${provider === "para" ? "Para" : "Privy"} is not available on this page. It cannot be connected through another provider.`,
        );
      }
      const brand = resolveWalletBrandKey(
        `${wallet.walletName ?? ""} ${wallet.label ?? ""} ${
          wallet.provider ?? ""
        }`,
      );

      if (wallet.family === "evm" && adapter.connectEvmWallet) {
        const option = adapter.evmWallets?.find((candidate) => {
          const candidateBrand = resolveWalletBrandKey(
            `${candidate.id} ${candidate.label}`,
          );
          return brand
            ? candidateBrand === brand
            : candidate.label.toLowerCase() ===
                (wallet.walletName ?? wallet.label ?? "").toLowerCase();
        });
        if (option) {
          await adapter.connectEvmWallet(option.id);
          return;
        }
      }

      if (wallet.family === "svm" && adapter.connectSolanaWallet) {
        const option = adapter.solanaWallets?.find((candidate) => {
          const candidateBrand = resolveWalletBrandKey(candidate.name);
          return brand
            ? candidateBrand === brand
            : candidate.name.toLowerCase() ===
                (wallet.walletName ?? wallet.label ?? "").toLowerCase();
        });
        if (option) {
          await adapter.connectSolanaWallet(option.name);
          return;
        }
      }

      await adapter.connect({ family: wallet.family });
    });
  };

  return (
    <div className="flex flex-col">
      <AccountManagement
        user={adapter.accountUser}
        displayEmailHint={displayEmailHint}
        wallets={wallets}
        signInMethods={signInMethods}
        canAddWallet
        addSignInOptions={addSignInOptions}
        pending={pending}
        error={actionError ?? (acl.status === "error" ? acl.error : null)}
        onRenameAccount={
          adapter.updateAccount
            ? async (displayName) => {
                await run("account:rename", () =>
                  adapter.updateAccount!({ displayName: displayName || null }),
                );
              }
            : undefined
        }
        onAddWallet={requestWalletPickerOpen}
        onAddSignIn={async (option) => {
          await run(`add-sign-in:${option.id}`, async () => {
            const provider = providerOptions.find(
              (provider) => provider.id === option.id,
            );
            if (provider) {
              await provider.connect();
              return;
            }
            if (adapter.connectSocial) {
              await adapter.connectSocial(option.id);
              return;
            }
            await adapter.connect();
          });
        }}
        onLinkWallet={linkWallet}
        onConnectWallet={connectWallet}
        onSelectWallet={async (wallet) => {
          if (!wallet.connectionId) return;
          await run(`select:${wallet.key}`, () =>
            adapter.selectAccount(wallet.connectionId!),
          );
        }}
        onDisconnectWallet={
          adapter.disconnect
            ? async (wallet) => {
                await run(`disconnect:${wallet.key}`, () =>
                  adapter.disconnect!(
                    wallet.family === "evm" && wallet.connectionId
                      ? { accountId: wallet.connectionId }
                      : { family: wallet.family },
                  ),
                );
              }
            : undefined
        }
        onUnlinkWallet={adapter.unlinkLinkedWallet ? unlinkWallet : undefined}
        onUnlinkSignIn={
          adapter.unlinkLinkedAccount
            ? async (account) => {
                if (!window.confirm(`Unlink ${account.provider} sign-in?`)) {
                  return;
                }
                await run(`unlink-identity:${account.id}`, () =>
                  adapter.unlinkLinkedAccount!(account.id),
                );
              }
            : undefined
        }
        onSignOut={async () => {
          if (
            await run(
              "account:signout",
              () => signOutAndDisconnect(adapter),
              false,
            )
          )
            onClose?.();
        }}
        onDeleteAccount={
          adapter.deleteAccount
            ? async () => {
                if (
                  !window.confirm(
                    "Delete this Aomi account? Linked wallets and sign-in methods will be freed.",
                  )
                ) {
                  return;
                }
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
    </div>
  );
}
