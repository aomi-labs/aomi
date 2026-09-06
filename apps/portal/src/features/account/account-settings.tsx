"use client";

import { useMemo, useState } from "react";
import { signOutAndDisconnect, useAomiWalletKit } from "@aomi-labs/widget-lib";
import { AccountSigningView } from "./account-signing";
import {
  AccountManagement,
  type AddSignInOption,
  type AddWalletOption,
} from "./account-management/index";
import { useAccountAcl } from "./use-account-acl";
import {
  buildUnifiedAccountWallets,
  isProviderSigningWallet,
  visibleSignInMethods,
  type UnifiedAccountWallet,
} from "./wallet-management-model";
import { resolveWalletBrandKey } from "./wallet-brands";

/** Settings › Account is the canonical account, wallet, and signing surface. */
export function AccountSettings() {
  const adapter = useAomiWalletKit();
  const acl = useAccountAcl();
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const liveConnections = useMemo(() => {
    const rows = (adapter.walletModalRows ?? [])
      .filter(
        (row) =>
          row.source === "live" &&
          Boolean(row.address) &&
          (row.status === "active" || row.status === "connected"),
      )
      .map((row) => ({
        id: row.id,
        family: row.family,
        address: row.address!,
        chainId: row.chainId,
        walletName: row.walletName,
        provider: row.provider,
        active: row.status === "active",
      }));

    const addIdentityFallback = (
      family: "evm" | "svm",
      address: string | undefined,
      walletName?: string,
      chainId?: number,
    ) => {
      if (!address) return;
      const normalized = family === "evm" ? address.toLowerCase() : address;
      if (
        rows.some(
          (row) =>
            row.family === family &&
            (family === "evm" ? row.address.toLowerCase() : row.address) ===
              normalized,
        )
      ) {
        return;
      }
      rows.push({
        id: `identity:${family}:${normalized}`,
        family,
        address,
        chainId,
        walletName,
        provider: undefined,
        active: true,
      });
    };

    addIdentityFallback(
      "evm",
      adapter.identity.address,
      adapter.accounts.find(
        (account) =>
          account.family === "evm" &&
          account.address.toLowerCase() ===
            adapter.identity.address?.toLowerCase(),
      )?.walletName,
      adapter.identity.chainId,
    );
    addIdentityFallback(
      "svm",
      adapter.identity.svmAddress,
      adapter.identity.svmWalletName,
    );
    return rows;
  }, [adapter.accounts, adapter.identity, adapter.walletModalRows]);

  const wallets = useMemo(
    () =>
      buildUnifiedAccountWallets({
        accounts: adapter.accounts ?? [],
        linkedWallets: adapter.accountWallets ?? [],
        policies: acl.wallets,
        liveConnections,
      }),
    [acl.wallets, adapter.accountWallets, adapter.accounts, liveConnections],
  );
  const signInMethods = useMemo(
    () => visibleSignInMethods(adapter.accountLinkedAccounts ?? []),
    [adapter.accountLinkedAccounts],
  );
  const providerWallets = useMemo(
    () => acl.wallets.filter(isProviderSigningWallet),
    [acl.wallets],
  );
  const addWalletOptions = useMemo<AddWalletOption[]>(
    () => [
      ...(adapter.evmWallets ?? []).map((wallet) => ({
        id: wallet.id,
        family: "evm" as const,
        label: wallet.label,
        markKey: `${wallet.id} ${wallet.label}`,
        ready: wallet.status !== "unavailable",
      })),
      ...(adapter.solanaWallets ?? []).map((wallet) => ({
        id: wallet.name,
        family: "svm" as const,
        label: wallet.name,
        markKey: wallet.name,
        ready: wallet.ready,
      })),
    ],
    [adapter.evmWallets, adapter.solanaWallets],
  );
  const addSignInOptions = useMemo<AddSignInOption[]>(
    () =>
      (adapter.socialLoginOptions ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        ready: option.status !== "unavailable",
      })),
    [adapter.socialLoginOptions],
  );

  const run = async (
    key: string,
    action: () => Promise<void>,
    refresh = true,
  ) => {
    setPending(key);
    setActionError(null);
    try {
      await action();
      if (refresh) await acl.refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
    } finally {
      setPending(null);
    }
  };

  const linkWallet = async (wallet: UnifiedAccountWallet) => {
    if (!wallet.connectedAccountId) return;
    await run(`link:${wallet.key}`, async () => {
      if (adapter.linkWallet) {
        await adapter.linkWallet({
          accountId: wallet.connectedAccountId,
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
        active: wallet.active,
      });
    });
  };

  const unlinkWallet = async (wallet: UnifiedAccountWallet) => {
    if (!adapter.unlinkLinkedWallet || !wallet.accountWalletId) return;
    if (!window.confirm(`Unlink ${wallet.address} from this account?`)) return;
    await run(`unlink:${wallet.key}`, () =>
      adapter.unlinkLinkedWallet!(wallet.accountWalletId!),
    );
  };

  const connectWallet = async (wallet: UnifiedAccountWallet) => {
    await run(`connect:${wallet.key}`, async () => {
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
        wallets={wallets}
        signInMethods={signInMethods}
        addWalletOptions={addWalletOptions}
        addSignInOptions={addSignInOptions}
        pending={pending}
        error={actionError ?? (acl.status === "error" ? acl.error : null)}
        onRenameAccount={
          adapter.updateAccount
            ? async (displayName) =>
                run("account:rename", () =>
                  adapter.updateAccount!({ displayName: displayName || null }),
                )
            : undefined
        }
        onAddWallet={async (option) =>
          run(`add-wallet:${option.id}`, async () => {
            if (option.family === "evm" && adapter.connectEvmWallet) {
              await adapter.connectEvmWallet(option.id);
              return;
            }
            if (option.family === "svm" && adapter.connectSolanaWallet) {
              await adapter.connectSolanaWallet(option.id);
              return;
            }
            await adapter.connect({ family: option.family });
          })
        }
        onAddSignIn={async (option) =>
          run(`add-sign-in:${option.id}`, async () => {
            if (adapter.connectSocial) {
              await adapter.connectSocial(option.id);
              return;
            }
            await adapter.connect();
          })
        }
        onLinkWallet={linkWallet}
        onConnectWallet={connectWallet}
        onSelectWallet={async (wallet) => {
          if (!wallet.connectedAccountId) return;
          await run(`select:${wallet.key}`, () =>
            adapter.selectAccount(wallet.connectedAccountId!),
          );
        }}
        onDisconnectWallet={
          adapter.disconnect
            ? async (wallet) =>
                run(`disconnect:${wallet.key}`, () =>
                  adapter.disconnect!(
                    wallet.family === "evm" && wallet.connectedAccountId
                      ? { accountId: wallet.connectedAccountId }
                      : { family: wallet.family },
                  ),
                )
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
        onSignOut={async () =>
          run("account:signout", () => signOutAndDisconnect(adapter), false)
        }
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
                await run(
                  "account:delete",
                  async () => {
                    await adapter.deleteAccount!();
                    await adapter.disconnect?.({ family: "all" });
                  },
                  false,
                );
              }
            : undefined
        }
      />

      {acl.status === "loading" ? (
        <p className="text-aomi-muted px-[22px] pb-5 text-[13px]">
          Loading provider signing settings…
        </p>
      ) : providerWallets.length || acl.needsParaAgentWallet ? (
        <div className="border-aomi-border border-t">
          <AccountSigningView
            wallets={providerWallets}
            delegatedAccounts={acl.delegatedAccounts}
            unboundWallets={acl.unboundWallets}
            needsParaAgentWallet={acl.needsParaAgentWallet}
            onCommit={acl.commitMode}
            onBindWallet={acl.bindWallet}
            onProvisionParaAgentWallet={acl.provisionParaAgentWallet}
            onRevokeDelegation={acl.revokeDelegation}
            onStopAllAuto={acl.stopAllAuto}
            canConnectPrivy={acl.canConnectPrivy}
            onConnectPrivy={acl.connectPrivy}
            onRenewDelegation={acl.renewDelegation}
            blockedReason={acl.blockedReason}
          />
        </div>
      ) : null}
    </div>
  );
}
