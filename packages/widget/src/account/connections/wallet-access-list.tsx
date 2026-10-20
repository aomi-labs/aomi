"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { shortAddress, type AomiAgentWallet } from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { AomiMark } from "@/ui/aomi-mark";
import { Segmented } from "@/ui/aomi/segmented";
import {
  AddressSummary,
  Mono,
  StateMeta,
  withApp,
} from "@/account/account-management/labels";
import { familyTag } from "@/account/account-management/wallet-model";
import type { PairMode } from "./connection-pairs";

export type WalletAccess = { id: string; instant: boolean };

/**
 * Agent wallets a connection may use: a tick per wallet and Ask/Instant for
 * a ticked one. Under a ceiling Instant is greyed out; a paused wallet can
 * still be ticked but has no mode until it resumes.
 */
export function WalletAccessList({
  wallets,
  access,
  ceiling = false,
  /** The portal may always use every wallet: ticks are fixed on. */
  fixed = false,
  disabled = false,
  describe = describeWallet,
  onTick,
  onMode,
}: {
  wallets: readonly AomiAgentWallet[];
  access: readonly WalletAccess[];
  ceiling?: boolean;
  fixed?: boolean;
  disabled?: boolean;
  /** The line under a wallet's name. */
  describe?: (wallet: AomiAgentWallet) => ReactNode;
  onTick?: (wallet: AomiAgentWallet, ticked: boolean) => void;
  onMode: (wallet: AomiAgentWallet, mode: PairMode) => void;
}) {
  return (
    <div className="border-aomi-border bg-aomi-raised rounded-card divide-aomi-border divide-y overflow-hidden border">
      {wallets.map((wallet) => {
        const pair = access.find((entry) => entry.id === wallet.id);
        const ticked = fixed || Boolean(pair);
        return (
          <div
            key={wallet.id}
            data-wallet-access={wallet.id}
            className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5"
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={ticked}
              aria-label={`Allow ${wallet.name}`}
              disabled={disabled || fixed || !onTick}
              onClick={() => onTick?.(wallet, !ticked)}
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors disabled:cursor-default",
                ticked
                  ? "border-aomi-fg bg-aomi-fg text-aomi-bg"
                  : "border-aomi-border",
                fixed && "opacity-60",
              )}
            >
              {ticked ? <Check className="size-3" strokeWidth={3} /> : null}
            </button>
            <AomiMark
              size={15}
              className={cn(
                "text-aomi-fg shrink-0",
                wallet.paused && "opacity-40",
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-row truncate">{wallet.name}</span>
              <span className="type-meta text-aomi-muted truncate">
                {describe(wallet)}
              </span>
            </span>
            {wallet.paused ? (
              <StateMeta state="paused" />
            ) : (
              <Segmented
                label={`${wallet.name} mode`}
                size="sm"
                value={pair?.instant && !ceiling ? "instant" : "ask"}
                disabled={disabled || !ticked}
                onChange={(mode) => onMode(wallet, mode)}
                options={[
                  { value: "ask", label: "Ask" },
                  { value: "instant", label: "Instant", disabled: ceiling },
                ]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One address: it and its family in mono; two: `2 addresses · EVM/SVM`. Then
 * the app it is used by.
 */
function describeWallet(wallet: AomiAgentWallet): ReactNode {
  const [only] = wallet.addresses;
  return (
    <>
      {wallet.addresses.length === 1 && only ? (
        <Mono>
          {shortAddress(only.address)} · {familyTag(only.family)}
        </Mono>
      ) : (
        <AddressSummary
          families={wallet.addresses.map((entry) => entry.family)}
        />
      )}
      {withApp(wallet.app)}
    </>
  );
}
