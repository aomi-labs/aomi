"use client";

import type { DelegatedAccountView, SignerMode, WalletPolicy } from "./types";
import {
  findDelegationForWallet,
  reconcile,
  walletDisplayName,
  walletMarkKey,
  walletStatusLabel,
} from "./account-reconcile";
import { WalletProviderAvatar } from "./wallet-brands";
import { SigningModeList } from "./signing-mode-list";
import { ChevronDown, Loader2 } from "lucide-react";
import { Divider, SettingRow } from "./settings-rows";
import { shortenAddress } from "./account-api";

interface WalletPolicyRowProps {
  wallet: WalletPolicy;
  delegatedAccounts: DelegatedAccountView[];
  draft?: SignerMode;
  expanded: boolean;
  flash: boolean;
  busy: boolean;
  error?: string;
  blockedReason?: (wallet: WalletPolicy, mode: SignerMode) => string | null;
  onToggle: () => void;
  onDraft: (mode: SignerMode) => void;
  onCommit: () => void;
  onCancel: () => void;
  onRenewDelegation: () => void;
  onRevokeDelegation: (delegationId: string) => void;
}

export function WalletPolicyRow({
  wallet,
  delegatedAccounts,
  draft,
  expanded,
  flash,
  busy,
  error,
  blockedReason,
  onToggle,
  onDraft,
  onCommit,
  onCancel,
  onRenewDelegation,
  onRevokeDelegation,
}: WalletPolicyRowProps) {
  const selected = draft ?? wallet.desiredMode;
  const pending = draft !== undefined && draft !== wallet.desiredMode;
  const recon = reconcile(wallet);
  const open = expanded || pending;
  const delegation = findDelegationForWallet(delegatedAccounts, wallet);
  const displayName = walletDisplayName(wallet);
  const status = walletStatusLabel(wallet, recon, pending);
  const blocked = pending ? (blockedReason?.(wallet, selected) ?? null) : null;

  return (
    <div
      id={`wallet-${wallet.id}`}
      className={`transition-colors ${flash ? "bg-aomi-surface-2/40 ring-aomi-fg/20 ring-1 ring-inset" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer"
      >
        <SettingRow
          className="px-4"
          leading={
            <WalletProviderAvatar markKey={walletMarkKey(wallet)} size={18} />
          }
          title={displayName}
          desc={shortenAddress(wallet.address)}
          descMono
        >
          <span className="flex items-center gap-1">
            <span
              className={`max-w-[9.5rem] truncate text-right text-[13px] font-medium sm:max-w-none ${
                recon.status === "drifted"
                  ? "text-aomi-danger"
                  : "text-aomi-muted"
              }`}
            >
              {status}
            </span>
            <ChevronDown
              size={14}
              className={`text-aomi-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </SettingRow>
      </div>

      {open && (
        <div className="border-aomi-border bg-aomi-surface-2/15 flex flex-col gap-3 border-t px-4 pb-4 pt-3">
          <SigningModeList
            wallet={wallet}
            selected={selected}
            pending={pending}
            inset
            onSelect={onDraft}
          />

          {wallet.desiredMode === "auto" && delegation && (
            <>
              <Divider />
              <SettingRow
                className="py-2"
                title="Delegated account"
                desc={
                  recon.status === "drifted"
                    ? recon.detail
                    : `${delegation.provider} · ${delegation.kind}`
                }
              >
                {delegation.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => onRevokeDelegation(delegation.id)}
                    disabled={busy}
                    className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-8 items-center rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      "Revoke"
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRenewDelegation}
                    disabled={busy}
                    className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-8 items-center rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
                  >
                    Renew delegation
                  </button>
                )}
              </SettingRow>
            </>
          )}

          {pending ? (
            <div className="border-aomi-border bg-aomi-bg/60 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <span className="text-aomi-fg text-[13px]">
                {blocked ?? "Sign to apply this change."}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="text-aomi-muted hover:text-aomi-fg rounded-md px-2.5 py-1.5 text-[13px] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onCommit}
                  disabled={busy || Boolean(blocked)}
                  className="bg-aomi-accent-strong text-aomi-on-accent flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  {busy ? "Waiting for signature…" : "Sign to authorize"}
                </button>
              </div>
            </div>
          ) : (
            recon.status === "drifted" &&
            !(wallet.desiredMode === "auto" && delegation) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-aomi-muted text-[13px]">
                  {recon.detail}
                </span>
                <button
                  type="button"
                  onClick={onRenewDelegation}
                  disabled={busy}
                  className="border-aomi-border text-aomi-muted hover:bg-aomi-surface-2 hover:text-aomi-fg flex h-8 shrink-0 items-center rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
                >
                  {recon.action}
                </button>
              </div>
            )
          )}

          {error && (
            <span className="text-aomi-danger text-[13px]">{error}</span>
          )}

          <span className="text-aomi-muted/75 pt-0.5 text-[11px]">
            Last updated {wallet.lastPermit?.replace(/^you · /, "") ?? "—"}
          </span>
        </div>
      )}
    </div>
  );
}
