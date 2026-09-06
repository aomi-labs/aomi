"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LoaderCircle, WalletCards, X } from "lucide-react";
import {
  formatCredits,
  formatUsdc,
  MAX_TOP_UP_MICROUSD,
  MIN_TOP_UP_MICROUSD,
  truncateHex,
} from "./format";

export function CreditTopUpDialog({
  open,
  busy,
  credits,
  paymentReady,
  walletAddress,
  recoveryPending = false,
  error,
  onCreditsChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  credits: string;
  paymentReady: boolean;
  walletAddress?: string;
  recoveryPending?: boolean;
  error: string | null;
  onCreditsChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const parsedCredits = Number(credits);
  const amountMicrousd = Math.round(parsedCredits * 10_000);
  const validCredits =
    Number.isSafeInteger(amountMicrousd) &&
    amountMicrousd >= MIN_TOP_UP_MICROUSD &&
    amountMicrousd <= MAX_TOP_UP_MICROUSD;
  const cost = validCredits ? parsedCredits / 100 : 0;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[3px]" />
        <DialogPrimitive.Content className="border-aomi-overlay-border bg-aomi-raised text-aomi-fg fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[430px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.32)] focus:outline-none">
          <div className="border-aomi-border relative border-b px-5 py-4">
            <DialogPrimitive.Title className="text-[15px] font-semibold">
              Add credits
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-aomi-muted mt-1 pr-8 text-[12px] leading-relaxed">
              Choose an amount, then approve one USDC payment in your wallet.
            </DialogPrimitive.Description>
            <DialogPrimitive.Close
              type="button"
              disabled={busy}
              aria-label="Close top-up"
              className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50"
            >
              <X size={15} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-4 px-5 py-5">
            <fieldset>
              <legend className="text-aomi-muted mb-2 text-[11px] font-medium uppercase tracking-wide">
                Credit amount
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {[100, 500, 1000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={recoveryPending}
                    aria-pressed={credits === String(preset)}
                    onClick={() => onCreditsChange(String(preset))}
                    className={`focus-visible:ring-aomi-accent/40 rounded-lg border px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 ${
                      credits === String(preset)
                        ? "border-aomi-accent-outline bg-aomi-accent-tint"
                        : "border-aomi-border bg-aomi-bg/40 hover:bg-aomi-surface-2/60"
                    }`}
                  >
                    <span className="block text-[13px] font-medium tabular-nums">
                      {formatCredits(preset)}
                    </span>
                    <span className="text-aomi-muted mt-0.5 block text-[10px] tabular-nums">
                      {formatUsdc(preset / 100)}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-aomi-muted mb-2 block text-[11px] font-medium uppercase tracking-wide">
                Custom amount
              </span>
              <span className="border-aomi-border bg-aomi-bg focus-within:border-aomi-muted flex h-11 items-center rounded-lg border transition-colors">
                <input
                  aria-label="Top-up credits"
                  disabled={recoveryPending}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={100000}
                  step={1}
                  value={credits}
                  onChange={(event) => onCreditsChange(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm tabular-nums outline-none"
                />
                <span className="border-aomi-border text-aomi-muted border-l px-3 text-xs">
                  credits
                </span>
              </span>
              <span className="text-aomi-muted mt-1.5 block text-[11px]">
                100 credits = 1.00 USDC
              </span>
            </label>

            <div className="border-aomi-border bg-aomi-surface/45 overflow-hidden rounded-xl border">
              <div className="flex items-end justify-between gap-3 px-4 py-3.5">
                <div>
                  <span className="text-aomi-muted block text-[11px]">
                    You receive
                  </span>
                  <span className="mt-0.5 block text-lg font-semibold tabular-nums">
                    {validCredits ? formatCredits(parsedCredits) : "—"}{" "}
                    <span className="text-aomi-muted text-[12px] font-normal">
                      credits
                    </span>
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-aomi-muted block text-[11px]">
                    Total
                  </span>
                  <span className="mt-0.5 block text-lg font-semibold tabular-nums">
                    {validCredits ? formatUsdc(cost) : "—"}
                  </span>
                </div>
              </div>
              <div className="border-aomi-border grid grid-cols-2 border-t">
                <div className="border-aomi-border min-w-0 border-r px-4 py-2.5">
                  <span className="text-aomi-muted block text-[10px] uppercase tracking-wide">
                    Paying wallet
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium">
                    <WalletCards
                      size={12}
                      className={
                        paymentReady ? "text-aomi-success" : "text-aomi-danger"
                      }
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {walletAddress
                        ? truncateHex(walletAddress)
                        : "Not connected"}
                    </span>
                  </span>
                </div>
                <div className="px-4 py-2.5">
                  <span className="text-aomi-muted block text-[10px] uppercase tracking-wide">
                    Network
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium">
                    {recoveryPending
                      ? "Confirming previous payment"
                      : "Selected by payment challenge"}
                  </span>
                </div>
              </div>
            </div>

            {!validCredits ? (
              <p role="alert" className="text-aomi-danger text-xs">
                Choose between 1 and 100,000 credits.
              </p>
            ) : null}
            {!paymentReady ? (
              <p role="alert" className="text-aomi-danger text-xs">
                Connect an EVM wallet before topping up.
              </p>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="border-aomi-danger/25 bg-aomi-danger/5 text-aomi-danger rounded-lg border px-3 py-2.5 text-xs"
              >
                {error}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="border-aomi-border hover:bg-aomi-surface-2 h-9 rounded-lg border px-3.5 text-[13px] font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                type="button"
                disabled={busy || !validCredits || !paymentReady}
                onClick={onConfirm}
                className="bg-aomi-fg text-aomi-bg inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <LoaderCircle
                    size={14}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {busy
                  ? recoveryPending
                    ? "Checking payment…"
                    : "Confirm in wallet…"
                  : `Pay ${validCredits ? formatUsdc(cost) : ""}`}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
