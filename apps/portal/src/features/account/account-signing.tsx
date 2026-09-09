"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AomiAuthorizationChallenge } from "@aomi-labs/client";
import type { DelegatedAccountView, SignerMode, WalletPolicy } from "./types";
import type { UnboundWallet } from "./use-account-acl";
import {
  CUSTODY_GROUPS,
  reconcile,
  sortWallets,
  walletGroupKey,
  walletDisplayName,
  modeLabel,
  modeHintFor,
} from "./account-reconcile";
import { WalletPolicyRow } from "./wallet-policy-row";
import { UnboundWalletRow } from "./unbound-wallet-row";
import { Divider, SettingRow } from "./settings-rows";
import { Loader2 } from "lucide-react";

interface AccountSigningViewProps {
  wallets: WalletPolicy[];
  delegatedAccounts: DelegatedAccountView[];
  unboundWallets: UnboundWallet[];
  onPrepare: (
    wallet: WalletPolicy,
    mode: SignerMode,
  ) => Promise<AomiAuthorizationChallenge>;
  /** Sign the exact reviewed permit. Rejects with a user-facing message. */
  onCommit: (
    wallet: WalletPolicy,
    mode: SignerMode,
    challenge: AomiAuthorizationChallenge,
  ) => Promise<void>;
  onSelectWallet?: (wallet: WalletPolicy) => void;
  onBindWallet: (wallet: UnboundWallet) => Promise<"bound" | "already_bound">;
  onRevokeDelegation: (delegation: DelegatedAccountView) => Promise<void>;
  onStopAllAuto: () => Promise<void>;
  canConnectPrivy: boolean;
  onConnectPrivy: () => Promise<void>;
  onRenewDelegation: (wallet: WalletPolicy) => Promise<void>;
  /** Why a target mode can't be signed right now, or null when it can. */
  blockedReason?: (wallet: WalletPolicy, mode: SignerMode) => string | null;
}

/** Busy/error key for the account-wide "stop all auto-signing" action. */
const STOP_ALL_KEY = "__stop_all__";
const CONNECT_PRIVY_KEY = "__connect_privy__";

export function AccountSigningView({
  wallets,
  delegatedAccounts,
  unboundWallets,
  onCommit,
  onPrepare,
  onSelectWallet,
  onBindWallet,
  onRevokeDelegation,
  onStopAllAuto,
  canConnectPrivy,
  onConnectPrivy,
  onRenewDelegation,
  blockedReason,
}: AccountSigningViewProps) {
  const [drafts, setDrafts] = useState<Record<string, SignerMode>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seeded, setSeeded] = useState<Record<string, true>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{
    wallet: WalletPolicy;
    mode: SignerMode;
    challenge: AomiAuthorizationChallenge;
  } | null>(null);
  const confirming = useRef(false);

  useEffect(() => {
    const fresh = wallets.filter((w) => !seeded[w.id]);
    if (fresh.length === 0) return;
    setSeeded((s) => {
      const next = { ...s };
      for (const w of fresh) next[w.id] = true;
      return next;
    });
    const drifted = fresh.filter((w) => reconcile(w).status === "drifted");
    if (drifted.length === 0) return;
    setExpanded((e) => {
      const next = { ...e };
      for (const w of drifted) next[w.id] = true;
      return next;
    });
  }, [wallets, seeded]);

  const run = async (
    id: string,
    action: () => Promise<void>,
  ): Promise<boolean> => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    try {
      await action();
      return true;
    } catch (cause) {
      setErrors((e) => ({
        ...e,
        [id]: cause instanceof Error ? cause.message : "Something went wrong",
      }));
      return false;
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[id];
        return next;
      });
    }
  };

  const attentionCount = useMemo(
    () => wallets.filter((w) => reconcile(w).status === "drifted").length,
    [wallets],
  );

  const groups = useMemo(
    () =>
      CUSTODY_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        wallets: sortWallets(
          wallets.filter((w) => walletGroupKey(w) === group.key),
        ),
      })).filter((g) => g.wallets.length > 0),
    [wallets],
  );

  const activeDelegations = useMemo(
    () => delegatedAccounts.filter((item) => item.status === "active").length,
    [delegatedAccounts],
  );
  const hasActiveDelegations = activeDelegations > 0;

  // An unrelated delegated account (for example Para/Solana) must not hide the
  // Privy EVM setup action. Delegations are provider capabilities, not a single
  // account-wide on/off bit.
  const hasActivePrivyDelegation = useMemo(
    () =>
      delegatedAccounts.some(
        (delegation) =>
          delegation.status === "active" &&
          (delegation.providerKey ?? delegation.provider).toLowerCase() ===
            "privy" &&
          delegation.address.chain === "evm",
      ),
    [delegatedAccounts],
  );

  const jumpToAttention = () => {
    const target = wallets.find((w) => reconcile(w).status === "drifted");
    if (!target) return;
    setExpanded((e) => ({ ...e, [target.id]: true }));
    setFlashId(target.id);
    window.setTimeout(() => setFlashId(null), 1600);
    window.setTimeout(() => {
      const card = document.getElementById(`wallet-${target.id}`);
      const container = card?.closest(".overflow-y-auto");
      if (!card || !container) return;
      const cardRect = card.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      container.scrollTo({
        top:
          container.scrollTop +
          (cardRect.top - contRect.top) -
          (contRect.height - cardRect.height) / 2,
      });
    }, 80);
  };

  const setDraft = (id: string, mode: SignerMode) =>
    setDrafts((d) => ({ ...d, [id]: mode }));

  const cancelDraft = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const walletById = (id: string) => wallets.find((w) => w.id === id);

  const commit = async () => {
    if (!confirmation || confirming.current) return;
    const { wallet, mode, challenge } = confirmation;
    confirming.current = true;
    setConfirmation(null);
    try {
      const ok = await run(wallet.id, () => {
        const current = walletById(wallet.id);
        if (
          !current ||
          current.authVersion !== wallet.authVersion ||
          current.desiredMode !== wallet.desiredMode
        ) {
          throw new Error(
            "This wallet's policy changed. Review the updated policy before signing.",
          );
        }
        return onCommit(current, mode, challenge);
      });
      if (ok) cancelDraft(wallet.id);
    } finally {
      confirming.current = false;
    }
  };

  const renewDelegation = (id: string) => {
    const wallet = walletById(id);
    if (!wallet) return;
    void run(id, () => onRenewDelegation(wallet));
  };

  const revokeDelegation = (delegationId: string) => {
    const delegation = delegatedAccounts.find(
      (item) => item.id === delegationId,
    );
    if (!delegation) return;
    void run(delegationId, () => onRevokeDelegation(delegation));
  };

  const stopAllAuto = () => {
    void run(STOP_ALL_KEY, onStopAllAuto);
  };

  const connectPrivy = () => {
    void run(CONNECT_PRIVY_KEY, onConnectPrivy);
  };

  const bindWallet = (id: string) => {
    const wallet = unboundWallets.find((entry) => entry.id === id);
    if (!wallet) return;
    void run(id, async () => {
      await onBindWallet(wallet);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-[22px] py-5">
      <div className="flex flex-col gap-6">
        {attentionCount > 0 && (
          <div className="border-aomi-border bg-aomi-surface-2/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <span className="text-aomi-fg text-[13px]">
              {attentionCount}{" "}
              {attentionCount === 1 ? "wallet needs" : "wallets need"} a new
              provider delegation
            </span>
            <button
              type="button"
              onClick={jumpToAttention}
              className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium transition-colors"
            >
              Fix
            </button>
          </div>
        )}

        {canConnectPrivy && !hasActivePrivyDelegation && (
          <div className="border-aomi-border bg-aomi-surface-2/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <div className="min-w-0 flex-1">
              <span className="text-aomi-fg block text-[13px] font-medium">
                Enable automatic signing
              </span>
              <span className="text-aomi-muted mt-0.5 block text-[12px] leading-snug">
                Privy will ask once to add Aomi as a delegated requester. You
                can revoke it here at any time.
              </span>
              {errors[CONNECT_PRIVY_KEY] && (
                <span className="text-aomi-danger mt-1 block text-[12px]">
                  {errors[CONNECT_PRIVY_KEY]}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={connectPrivy}
              disabled={Boolean(busy[CONNECT_PRIVY_KEY])}
              className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
            >
              {busy[CONNECT_PRIVY_KEY] && (
                <Loader2 size={13} className="animate-spin" />
              )}
              {busy[CONNECT_PRIVY_KEY] ? "Waiting for Privy…" : "Enable"}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">Provider signing</span>
            <span className="text-aomi-muted text-[13px]">
              Configure signing for Para and Privy wallets. External wallets
              always remain under their wallet app’s control.
            </span>
            {activeDelegations > 0 && (
              <span className="text-aomi-muted text-[12px]">
                {activeDelegations} active provider{" "}
                {activeDelegations === 1 ? "delegation" : "delegations"} —
                expand a wallet to revoke
              </span>
            )}
          </div>

          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col">
                <span className="text-aomi-muted/80 px-0.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]">
                  {group.label}
                </span>
                <div className="border-aomi-border bg-aomi-bg/40 flex flex-col overflow-hidden rounded-lg border">
                  {group.wallets.map((wallet, index) => (
                    <div key={wallet.id}>
                      {index > 0 && <Divider />}
                      <WalletPolicyRow
                        wallet={wallet}
                        delegatedAccounts={delegatedAccounts}
                        draft={drafts[wallet.id]}
                        expanded={Boolean(expanded[wallet.id])}
                        flash={flashId === wallet.id}
                        busy={Boolean(busy[wallet.id])}
                        error={errors[wallet.id]}
                        blockedReason={blockedReason}
                        onToggle={() =>
                          setExpanded((e) => ({
                            ...e,
                            [wallet.id]: !e[wallet.id],
                          }))
                        }
                        onDraft={(mode) => setDraft(wallet.id, mode)}
                        onCommit={() => {
                          const mode = drafts[wallet.id];
                          if (mode && !confirming.current) {
                            confirming.current = true;
                            void run(wallet.id, async () => {
                              const challenge = await onPrepare(wallet, mode);
                              setConfirmation({ wallet, mode, challenge });
                            }).finally(() => {
                              confirming.current = false;
                            });
                          }
                        }}
                        onSelectWallet={
                          onSelectWallet
                            ? () => {
                                void run(wallet.id, async () => {
                                  onSelectWallet(wallet);
                                });
                              }
                            : undefined
                        }
                        onCancel={() => cancelDraft(wallet.id)}
                        onRenewDelegation={() => renewDelegation(wallet.id)}
                        onRevokeDelegation={revokeDelegation}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {unboundWallets.length > 0 && (
              <div className="flex flex-col">
                <span className="text-aomi-muted/80 px-0.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em]">
                  Connected wallets
                </span>
                <div className="border-aomi-border bg-aomi-bg/40 flex flex-col overflow-hidden rounded-lg border">
                  {unboundWallets.map((wallet, index) => (
                    <div key={wallet.id}>
                      {index > 0 && <Divider />}
                      <UnboundWalletRow
                        wallet={wallet}
                        busy={Boolean(busy[wallet.id])}
                        error={errors[wallet.id]}
                        onActivate={() => bindWallet(wallet.id)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {hasActiveDelegations && (
          <div className="flex flex-col pt-1">
            <Divider />
            <SettingRow
              className="pt-4"
              title="Stop all auto-signing"
              desc="Revokes every provider delegation. Auto execution stops until you renew delegation or explicitly choose Manual."
            >
              <button
                type="button"
                onClick={stopAllAuto}
                disabled={Boolean(busy[STOP_ALL_KEY])}
                className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
              >
                {busy[STOP_ALL_KEY] && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                Revoke all
              </button>
            </SettingRow>
            {errors[STOP_ALL_KEY] && (
              <p className="text-aomi-danger text-[13px]">
                {errors[STOP_ALL_KEY]}
              </p>
            )}
          </div>
        )}
      </div>
      <Dialog.Root
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[3px]" />
          <Dialog.Content className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] focus:outline-none">
            <Dialog.Title className="text-lg font-semibold">
              Confirm signing policy
            </Dialog.Title>
            <Dialog.Description className="text-aomi-muted mt-2 text-sm">
              Review this wallet’s new permissions before authorizing the
              change.
            </Dialog.Description>
            {confirmation && (
              <>
                <div className="border-aomi-border mt-5 rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {walletDisplayName(confirmation.wallet)} ·{" "}
                    {confirmation.wallet.chain === "evm"
                      ? "Ethereum"
                      : "Solana"}
                  </p>
                  <p className="text-aomi-muted mt-1 break-all font-mono text-xs">
                    {confirmation.wallet.address}
                  </p>
                  <p className="mt-4 font-semibold">
                    {modeLabel(confirmation.wallet.desiredMode)} →{" "}
                    {modeLabel(confirmation.mode)}
                  </p>
                  <p className="text-aomi-muted mt-2 text-sm">
                    {modeHintFor(confirmation.wallet, confirmation.mode)}
                  </p>
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium">
                    {confirmation.wallet.chain === "evm"
                      ? "EIP-712 typed data"
                      : "Solana message"}
                  </p>
                  <pre
                    aria-label="Payload to sign"
                    className="border-aomi-border bg-aomi-bg mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-xs"
                  >
                    {confirmation.wallet.chain === "evm"
                      ? JSON.stringify(
                          confirmation.challenge.typed_data,
                          null,
                          2,
                        )
                      : new TextDecoder().decode(
                          Uint8Array.from(
                            atob(confirmation.challenge.message_base64 ?? ""),
                            (c) => c.charCodeAt(0),
                          ),
                        )}
                  </pre>
                </div>
                <p className="text-aomi-muted mt-4 text-sm">
                  Sign the payload above to authorize this policy change. The
                  backend verifies your wallet signature before applying it. An
                  embedded wallet may sign without another popup. No funds will
                  be sent.
                </p>
              </>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="border-aomi-border rounded-lg border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void commit()}
                className="bg-aomi-accent-strong text-aomi-on-accent rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Sign to approve
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
