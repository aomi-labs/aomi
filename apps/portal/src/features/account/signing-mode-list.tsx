"use client";

import type { SignerMode, WalletPolicy } from "./types";
import {
  SIGNER_MODES,
  modeHintFor,
  modeValidFor,
  unavailableReason,
} from "./account-reconcile";

interface SigningModeListProps {
  wallet: WalletPolicy;
  selected: SignerMode;
  pending: boolean;
  inset?: boolean;
  onSelect: (mode: SignerMode) => void;
}

export function SigningModeList({
  wallet,
  selected,
  pending,
  inset = false,
  onSelect,
}: SigningModeListProps) {
  return (
    <div
      className={`divide-aomi-border flex flex-col divide-y rounded-lg ${
        inset ? "bg-aomi-surface-2/35" : "border-aomi-border border"
      }`}
    >
      {SIGNER_MODES.map((mode) => {
        const valid = modeValidFor(wallet, mode.id);
        const isSelected = selected === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            disabled={!valid}
            onClick={() => onSelect(mode.id)}
            className={`flex items-start gap-3 px-4 py-3 text-left transition-colors ${
              isSelected ? "bg-aomi-surface-2/60" : "hover:bg-aomi-surface-2/30"
            } ${!valid ? "cursor-not-allowed opacity-40" : ""} ${
              isSelected && pending ? "ring-aomi-fg/20 ring-1 ring-inset" : ""
            }`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                isSelected
                  ? "border-aomi-fg bg-aomi-fg"
                  : "border-aomi-border bg-aomi-bg"
              }`}
            >
              {isSelected && (
                <span className="bg-aomi-bg h-1.5 w-1.5 rounded-full" />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={`text-sm font-medium leading-none ${isSelected ? "text-aomi-fg" : ""}`}
              >
                {mode.label}
              </span>
              <span className="text-aomi-muted text-[12px] leading-snug">
                {modeHintFor(wallet, mode.id)}
              </span>
              {!valid && (
                <span className="text-aomi-muted/80 text-[11px] leading-snug">
                  {unavailableReason(wallet, mode.id)}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
