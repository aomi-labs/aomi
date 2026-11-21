"use client";

import { AomiButton } from "@/ui/aomi/button";
import { formatWalletAddress } from "./identity";

export function DisconnectConfirmDialog({
  open,
  mode,
  address,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  mode: "signout" | "disconnect";
  address?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const label = address ? formatWalletAddress(address) : "this wallet";
  const signingOut = mode === "signout";
  const title = signingOut ? "Sign out of Aomi?" : "Disconnect wallet?";
  const description = signingOut
    ? "Ends your Aomi account session and disconnects wallets from this browser."
    : `Stops using ${label} in Aomi. Your Aomi account stays signed in.`;
  const actionLabel = signingOut ? "Sign out" : "Disconnect";
  const busyLabel = signingOut ? "Signing out…" : "Disconnecting…";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 cursor-default bg-black/55"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-dialog-title"
        className="border-aomi-border bg-aomi-raised relative w-full max-w-[400px] rounded-t-xl border border-b-0 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:rounded-lg sm:border-b sm:pb-6"
      >
        <h2
          id="disconnect-dialog-title"
          className="text-aomi-fg text-base font-semibold"
        >
          {title}
        </h2>
        <p className="text-aomi-muted mt-2 text-[14px] leading-5">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2.5">
          <AomiButton
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9"
          >
            Cancel
          </AomiButton>
          <AomiButton
            type="button"
            onClick={onConfirm}
            disabled={busy}
            variant="secondary"
            className="h-9"
          >
            {busy ? busyLabel : actionLabel}
          </AomiButton>
        </div>
      </div>
    </div>
  );
}
