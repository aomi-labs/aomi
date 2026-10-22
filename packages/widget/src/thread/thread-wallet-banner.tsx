"use client";

import { useState, type FC } from "react";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import type { AomiActiveWallet } from "@aomi-labs/client";
import { useAomiWalletKit, walletChoice } from "@/wallet/context";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { parseWalletRef } from "@aomi-labs/client";
import { rowTitle } from "@/account/account-management/wallet-model";

/** The first family whose chat wallet is not the one this device picked. */
export function threadWalletMismatch(
  active: AomiActiveWallet | undefined,
  rows: readonly WalletRow[],
): { family: "evm" | "svm"; active: string; pick: string } | null {
  if (!active) return null;
  const { pick } = walletChoice(rows);
  for (const family of ["evm", "svm"] as const) {
    const current = active[family];
    const mine = pick[family];
    if (current && mine && current !== mine)
      return { family, active: current, pick: mine };
  }
  return null;
}

/**
 * Shown when the open chat signs with a wallet other than this device's
 * pick (picked on another device, or switched by the model's `use_wallet`).
 */
export const ThreadWalletBanner: FC = () => {
  const runtime = useOptionalAomiRuntime();
  const kit = useAomiWalletKit();
  const mismatch = threadWalletMismatch(runtime?.activeWallet, kit.wallets);
  const setThreadWallet = runtime?.setThreadWallet;
  if (!mismatch || !setThreadWallet) return null;
  return (
    <ThreadWalletSwitch
      active={mismatch.active}
      pick={mismatch.pick}
      rows={kit.wallets}
      setThreadWallet={setThreadWallet}
    />
  );
};

const labelOf = (rows: readonly WalletRow[], id: string) => {
  const row = rows.find(
    (candidate) => candidate.linkedWalletId === parseWalletRef(id),
  );
  return row ? rowTitle(row).title : "another wallet";
};

/** "This chat uses <wallet> · Switch"; Switch moves the chat to this device's pick. */
function ThreadWalletSwitch({
  active,
  pick,
  rows,
  setThreadWallet,
}: {
  active: string;
  pick: string;
  rows: readonly WalletRow[];
  setThreadWallet: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onSwitch = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await setThreadWallet(pick);
    } catch (cause) {
      setError(switchFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <p
      role="status"
      data-thread-wallet={active}
      className="text-aomi-muted px-4 pb-3 text-[12px]"
    >
      This chat uses{" "}
      <span className="text-aomi-fg">{labelOf(rows, active)}</span>
      {" · "}
      <button
        type="button"
        disabled={busy}
        aria-label={`Switch this chat to ${labelOf(rows, pick)}`}
        onClick={() => void onSwitch()}
        className="text-aomi-fg font-medium underline-offset-2 hover:underline disabled:opacity-60"
      >
        Switch
      </button>
      {error ? <span className="text-aomi-danger"> · {error}</span> : null}
    </p>
  );
}

function switchFailure(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "wallet_switch_pending")
    return "Finish or cancel this chat’s pending transaction first.";
  if (code === "wallet_switch_unavailable")
    return "This chat can’t switch wallets.";
  if (code === "wallet_not_found") return "That wallet isn’t in your account.";
  return "Couldn’t switch. Try again.";
}
