"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AomiAuthorizationChallenge } from "@aomi-labs/client";
import type { DelegatedAccountView, SignerMode, WalletPolicy } from "./types";
import {
  findDelegationForWallet,
  reconcile,
  sortWallets,
  walletDisplayName,
  modeLabel,
  modeHintFor,
  walletMarkKey,
} from "./account-reconcile";
import { WalletPolicyRow, walletAddressLine } from "./wallet-policy-row";
import { WalletProviderAvatar } from "./wallet-brands";
import { isProviderSigningWallet } from "./wallet-management-model";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { AomiButton } from "../../../ui/aomi/button";
import { ConfirmDialog } from "../../../ui/aomi/confirm-dialog";
import { ListGroup, ListRow } from "../../../ui/aomi/list-group";
import { SectionHeader } from "../../../ui/aomi/section-header";

interface AccountSigningViewProps {
  wallets: WalletPolicy[];
  delegatedAccounts: DelegatedAccountView[];
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
  onRevokeDelegation: (delegation: DelegatedAccountView) => Promise<void>;
  onStopAllAuto: () => Promise<void>;
  onSelectWallet?: (wallet: WalletPolicy) => void;
  canConnectPrivy: boolean;
  onConnectPrivy: () => Promise<void>;
  onRenewDelegation: (wallet: WalletPolicy) => Promise<void>;
  /** Why a target mode can't be signed right now, or null when it can. */
  blockedReason?: (wallet: WalletPolicy, mode: SignerMode) => string | null;
}

/** Busy/error key for the account-wide "stop all auto-signing" action. */
const STOP_ALL_KEY = "__stop_all__";
const CONNECT_PRIVY_KEY = "__connect_privy__";

const automaticKey = (wallet: WalletPolicy) => `automatic:${wallet.id}`;

function ErrorLine({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className="type-meta text-aomi-danger px-3.5 pb-3">
      {children}
    </p>
  ) : null;
}

/**
 * The Safety tab's signing controls: one Ask me / Auto / Locked choice per
 * signable address, then provider-delegated automatic signing. Every change
 * runs the permit ceremony — prepare, review the exact payload, sign, commit.
 */
export function AccountSigningView({
  wallets,
  delegatedAccounts,
  onCommit,
  onPrepare,
  onRevokeDelegation,
  onStopAllAuto,
  onSelectWallet,
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
    /** Busy/error key of the row that asked for the change. */
    key: string;
  } | null>(null);
  const confirming = useRef(false);

  // Only a delegation can drift, and its controls live in Automatic signing:
  // open those for any wallet that arrives drifted.
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
      for (const w of drifted) next[automaticKey(w)] = true;
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

  // Provider-managed agent wallets hold no user key, so their only choice is
  // automatic signing on or off; they appear in that group alone.
  const signingWallets = useMemo(
    () => sortWallets(wallets.filter((wallet) => !wallet.providerManaged)),
    [wallets],
  );

  const automaticWallets = useMemo(
    () =>
      sortWallets(
        wallets.filter(
          (wallet) =>
            wallet.providerManaged ||
            wallet.desiredMode === "auto" ||
            wallet.canUseAuto,
        ),
      ),
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
  const offerPrivy = canConnectPrivy && !hasActivePrivyDelegation;

  // External-only accounts have nothing to delegate; skip the whole group.
  const showAutomatic =
    automaticWallets.length > 0 ||
    offerPrivy ||
    hasActiveDelegations ||
    wallets.some(isProviderSigningWallet);

  const jumpToAttention = () => {
    const target = wallets.find((w) => reconcile(w).status === "drifted");
    if (!target) return;
    setExpanded((e) => ({ ...e, [automaticKey(target)]: true }));
    setFlashId(target.id);
    window.setTimeout(() => setFlashId(null), 1600);
    window.setTimeout(() => {
      const card = document.getElementById(`automatic-wallet-${target.id}`);
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

  const cancelDraft = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const walletById = (id: string) => wallets.find((w) => w.id === id);

  /** Fetch the permit for `mode` and open it for review; nothing is signed yet. */
  const review = (wallet: WalletPolicy, mode: SignerMode, key: string) => {
    if (confirming.current) return;
    confirming.current = true;
    void run(key, async () => {
      const challenge = await onPrepare(wallet, mode);
      setConfirmation({ wallet, mode, challenge, key });
    })
      .then((ok) => {
        if (!ok) cancelDraft(wallet.id);
      })
      .finally(() => {
        confirming.current = false;
      });
  };

  const choose = (wallet: WalletPolicy, mode: SignerMode) => {
    if (mode === wallet.desiredMode || confirming.current || confirmation)
      return;
    const blocked = blockedReason?.(wallet, mode) ?? null;
    if (blocked) {
      setErrors((e) => ({ ...e, [wallet.id]: blocked }));
      return;
    }
    setDrafts((d) => ({ ...d, [wallet.id]: mode }));
    review(wallet, mode, wallet.id);
  };

  const dismiss = () => {
    if (confirmation) cancelDraft(confirmation.wallet.id);
    setConfirmation(null);
  };

  const commit = async () => {
    if (!confirmation || confirming.current) return;
    const { wallet, mode, challenge, key } = confirmation;
    confirming.current = true;
    setConfirmation(null);
    try {
      await run(key, () => {
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
    } finally {
      cancelDraft(wallet.id);
      confirming.current = false;
    }
  };

  const renewDelegation = (wallet: WalletPolicy) => {
    void run(automaticKey(wallet), () => onRenewDelegation(wallet));
  };

  const revokeDelegation = (delegation: DelegatedAccountView, key: string) => {
    void run(key, () => onRevokeDelegation(delegation));
  };

  const enabledCount = wallets.filter(
    (wallet) => wallet.desiredMode === "auto" && wallet.delegationActive,
  ).length;

  return (
    <div className="flex flex-col gap-8">
      {attentionCount > 0 && (
        <div className="border-aomi-border bg-aomi-surface-2 rounded-card flex items-center justify-between gap-3 border px-3.5 py-3">
          <span className="type-control text-aomi-fg">
            {attentionCount}{" "}
            {attentionCount === 1 ? "wallet needs" : "wallets need"} a new
            provider delegation
          </span>
          <AomiButton size="sm" onClick={jumpToAttention}>
            Fix
          </AomiButton>
        </div>
      )}

      <section
        aria-labelledby="signing-heading"
        className="flex flex-col gap-2"
      >
        <SectionHeader
          id="signing-heading"
          title="Signing"
          detail="Per wallet"
          help="Ask me: you approve every transaction. Auto: Aomi signs within your rules. Locked: this wallet can't sign. Loosening asks that wallet to sign once; tightening can be signed by any wallet on your account."
        />
        <ListGroup>
          {signingWallets.length ? (
            signingWallets.map((wallet) => (
              <WalletPolicyRow
                key={wallet.id}
                wallet={wallet}
                draft={drafts[wallet.id]}
                busy={Boolean(busy[wallet.id])}
                error={errors[wallet.id]}
                onSelect={(mode) => choose(wallet, mode)}
              />
            ))
          ) : (
            <p className="type-control text-aomi-muted px-3.5 py-4">
              Link a wallet in Account to choose how it signs.
            </p>
          )}
        </ListGroup>
      </section>

      {showAutomatic ? (
        <section
          aria-labelledby="automatic-signing-heading"
          className="flex flex-col gap-2"
        >
          <SectionHeader
            id="automatic-signing-heading"
            title="Automatic signing"
            detail={`${enabledCount} enabled`}
            help="Provider-delegated wallets that can sign async execution even when this browser is closed. External browser wallets cannot be used here."
          />
          <ListGroup>
            {offerPrivy ? (
              <div>
                <ListRow
                  title="Enable automatic signing"
                  description="Privy will ask once to add Aomi as a delegated requester. You can revoke it here at any time."
                  trailing={
                    <AomiButton
                      size="sm"
                      onClick={() =>
                        void run(CONNECT_PRIVY_KEY, onConnectPrivy)
                      }
                      disabled={Boolean(busy[CONNECT_PRIVY_KEY])}
                    >
                      {busy[CONNECT_PRIVY_KEY] && (
                        <Loader2 className="animate-spin" />
                      )}
                      {busy[CONNECT_PRIVY_KEY]
                        ? "Waiting for Privy…"
                        : "Enable"}
                    </AomiButton>
                  }
                />
                <ErrorLine>{errors[CONNECT_PRIVY_KEY]}</ErrorLine>
              </div>
            ) : null}

            {automaticWallets.map((wallet) => {
              const recon = reconcile(wallet);
              const delegation = findDelegationForWallet(
                delegatedAccounts,
                wallet,
              );
              const enabled =
                wallet.desiredMode === "auto" && wallet.delegationActive;
              const key = automaticKey(wallet);
              const open = Boolean(expanded[key]);
              const rowBusy = Boolean(busy[key]);
              return (
                <div
                  key={wallet.id}
                  id={`automatic-wallet-${wallet.id}`}
                  className={cn(
                    "transition-colors",
                    flashId === wallet.id &&
                      "bg-aomi-hover ring-aomi-fg/20 ring-1 ring-inset",
                  )}
                >
                  <ListRow
                    leading={
                      <WalletProviderAvatar
                        markKey={walletMarkKey(wallet)}
                        size={18}
                      />
                    }
                    title={walletDisplayName(wallet)}
                    description={walletAddressLine(wallet)}
                    descriptionMono
                    trailing={
                      enabled ? (
                        <AomiButton
                          size="sm"
                          aria-expanded={open}
                          onClick={() =>
                            setExpanded((value) => ({
                              ...value,
                              [key]: !open,
                            }))
                          }
                        >
                          Manage
                          <ChevronDown
                            className={cn(
                              "transition-transform",
                              open && "rotate-180",
                            )}
                          />
                        </AomiButton>
                      ) : recon.status === "drifted" ? (
                        <AomiButton
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => renewDelegation(wallet)}
                        >
                          Renew
                        </AomiButton>
                      ) : wallet.canUseAuto ? (
                        <AomiButton
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => review(wallet, "auto", key)}
                        >
                          Set up
                        </AomiButton>
                      ) : (
                        <span className="type-meta text-aomi-muted">
                          Not enabled
                        </span>
                      )
                    }
                  />
                  {wallet.desiredMode === "auto" ? (
                    <p
                      className={cn(
                        "type-meta -mt-1.5 pb-3 pl-[58px] pr-3.5",
                        recon.status === "drifted"
                          ? "text-aomi-danger"
                          : "text-aomi-muted",
                      )}
                    >
                      {recon.detail}
                    </p>
                  ) : null}
                  {open ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 px-3.5 pb-3">
                      {onSelectWallet ? (
                        <AomiButton
                          size="sm"
                          disabled={rowBusy}
                          onClick={() =>
                            void run(key, async () => onSelectWallet(wallet))
                          }
                        >
                          Use for this session
                        </AomiButton>
                      ) : null}
                      {delegation?.status === "active" ? (
                        <AomiButton
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => revokeDelegation(delegation, key)}
                        >
                          Revoke delegation
                        </AomiButton>
                      ) : null}
                      <AomiButton
                        size="sm"
                        variant="danger"
                        disabled={rowBusy}
                        onClick={() =>
                          review(
                            wallet,
                            wallet.providerManaged ? "denied" : "manual",
                            key,
                          )
                        }
                      >
                        Turn off
                      </AomiButton>
                    </div>
                  ) : null}
                  <ErrorLine>{errors[key]}</ErrorLine>
                </div>
              );
            })}

            {!automaticWallets.length && !offerPrivy ? (
              <p className="type-control text-aomi-muted px-3.5 py-4">
                No provider wallet is available for automatic signing.
              </p>
            ) : null}

            {hasActiveDelegations ? (
              <div>
                <ListRow
                  title="Stop all auto-signing"
                  description="Revokes every provider delegation. Auto execution stops until you renew delegation or explicitly choose Ask me."
                  trailing={
                    <AomiButton
                      size="sm"
                      variant="danger"
                      onClick={() => void run(STOP_ALL_KEY, onStopAllAuto)}
                      disabled={Boolean(busy[STOP_ALL_KEY])}
                    >
                      {busy[STOP_ALL_KEY] && (
                        <Loader2 className="animate-spin" />
                      )}
                      Revoke all
                    </AomiButton>
                  }
                />
                <ErrorLine>{errors[STOP_ALL_KEY]}</ErrorLine>
              </div>
            ) : null}
          </ListGroup>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
        onConfirm={() => void commit()}
        closeOnConfirm={false}
        title="Confirm signing policy"
        description="Review this wallet’s new permissions before authorizing the change."
        confirmLabel="Sign to approve"
      >
        {confirmation ? (
          <div className="flex flex-col gap-4">
            <div className="border-aomi-border rounded-control border p-3.5">
              <p className="type-row">
                {walletDisplayName(confirmation.wallet)}
              </p>
              <p className="type-address text-aomi-muted mt-1 break-all">
                {confirmation.wallet.address} ·{" "}
                {confirmation.wallet.chain === "evm" ? "EVM" : "SVM"}
              </p>
              <p className="type-row mt-3">
                {modeLabel(confirmation.wallet.desiredMode)} →{" "}
                {modeLabel(confirmation.mode)}
              </p>
              <p className="type-meta text-aomi-muted mt-1">
                {modeHintFor(confirmation.wallet, confirmation.mode)}
              </p>
            </div>
            <div>
              <p className="type-section">
                {confirmation.wallet.chain === "evm"
                  ? "EIP-712 typed data"
                  : "Solana message"}
              </p>
              <pre
                aria-label="Payload to sign"
                className="border-aomi-border bg-aomi-bg type-address rounded-control mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all border p-3"
              >
                {confirmation.wallet.chain === "evm"
                  ? JSON.stringify(confirmation.challenge.typed_data, null, 2)
                  : new TextDecoder().decode(
                      Uint8Array.from(
                        atob(confirmation.challenge.message_base64 ?? ""),
                        (c) => c.charCodeAt(0),
                      ),
                    )}
              </pre>
            </div>
            <p className="type-meta text-aomi-muted">
              Sign the payload above to authorize this policy change. The
              backend verifies your wallet signature before applying it. An
              embedded wallet may sign without another popup. No funds will be
              sent.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
