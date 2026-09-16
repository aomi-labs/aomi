"use client";

import type { UnboundWallet } from "./use-account-acl";
import { walletNameToMarkKey } from "./account-reconcile";
import { WalletProviderAvatar } from "./wallet-brands";
import { Loader2 } from "lucide-react";
import { SettingRow } from "./settings-rows";
import { shortenAddress } from "./account-api";

interface UnboundWalletRowProps {
  wallet: UnboundWallet;
  busy: boolean;
  error?: string;
  onActivate: () => void;
}

export function UnboundWalletRow({ wallet, busy, error, onActivate }: UnboundWalletRowProps) {
  const markKey =
    walletNameToMarkKey(wallet.walletName) ??
    walletNameToMarkKey(wallet.provider) ??
    null;
  const displayName = wallet.walletName ?? (wallet.chain === "evm" ? "Self-custody" : "Solana");

  return (
    <div id={`wallet-${wallet.id}`}>
      <SettingRow
        className="px-4"
        leading={<WalletProviderAvatar markKey={markKey} size={18} />}
        title={displayName}
        desc={shortenAddress(wallet.address)}
        descMono
      >
        <button
          type="button"
          onClick={onActivate}
          disabled={busy}
          className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:opacity-50"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? "Waiting for signature…" : "Activate"}
        </button>
      </SettingRow>
      {error && (
        <p className="text-aomi-danger px-4 pb-2 text-[13px]">{error}</p>
      )}
    </div>
  );
}
