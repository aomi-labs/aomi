import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { shortAddress } from "@aomi-labs/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import type { WalletFamily } from "@/wallet/types";
import { BrandMark } from "./controls";
import {
  appName,
  familySlots,
  familyTag,
  pendingHint,
  rowTitle,
} from "./wallet-model";

export function FamilyTag({ family }: { family: WalletFamily }) {
  return (
    <span className="border-aomi-border text-aomi-muted inline-flex h-4 items-center rounded-[5px] border px-1 font-mono text-[10px] font-medium leading-none">
      {familyTag(family)}
    </span>
  );
}

/**
 * The top of Wallets & access: which address signs for each family right
 * now. Each slot opens a picker over every address of that family.
 */
export function SignsWithStrip({
  rows,
  disabled,
  onActivate,
}: {
  rows: readonly WalletRow[];
  disabled: boolean;
  onActivate?: (row: WalletRow) => void;
}) {
  const slots = familySlots(rows);
  if (!slots.length) return null;
  return (
    <div
      className={cn(
        "divide-aomi-border grid divide-y sm:divide-x sm:divide-y-0",
        slots.length > 1 && "sm:grid-cols-2",
      )}
    >
      {slots.map((slot) => (
        <FamilySlot
          key={slot.family}
          family={slot.family}
          rows={slot.rows}
          current={slot.current}
          disabled={disabled}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}

function FamilySlot({
  family,
  rows,
  current,
  disabled,
  onActivate,
}: {
  family: WalletFamily;
  rows: WalletRow[];
  current: WalletRow;
  disabled: boolean;
  onActivate?: (row: WalletRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const tag = familyTag(family);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${tag} signs with ${rowTitle(current).title}`}
          disabled={disabled}
          className="hover:bg-aomi-hover focus-visible:bg-aomi-hover flex min-w-0 items-center gap-2 px-3.5 py-2.5 text-left outline-none transition-colors"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-meta text-aomi-muted flex items-center gap-1.5">
              <FamilyTag family={family} />
              signs with
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <BrandMark brand={appName(current)} size={13} box={16} />
              <span className="type-control truncate font-medium">
                {rowTitle(current).title}
                <span className="text-aomi-muted font-normal">
                  {" · "}
                  <span className="font-mono">
                    {shortAddress(current.address)}
                  </span>
                </span>
              </span>
            </span>
          </span>
          <ChevronDown className="text-aomi-muted size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={`${tag} wallets`}
        align="start"
        sideOffset={4}
        className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-card shadow-popover z-[90] w-[min(20rem,calc(100vw-2rem))] border p-1"
      >
        {rows.map((row) => {
          const hint = pendingHint(row);
          const { title, app } = rowTitle(row);
          return (
            <button
              key={row.key}
              type="button"
              role="menuitemradio"
              aria-checked={row.active}
              onClick={() => {
                setOpen(false);
                if (!row.active) onActivate?.(row);
              }}
              className="hover:bg-aomi-hover focus:bg-aomi-hover group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left outline-none"
            >
              <BrandMark
                brand={appName(row)}
                dot={row.connected ? "on" : "off"}
                size={15}
                box={28}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="type-control flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate">{title}</span>
                  {app ? (
                    <span className="type-meta text-aomi-muted">{app}</span>
                  ) : null}
                </span>
                <span className="type-address text-aomi-muted truncate">
                  {shortAddress(row.address)}
                </span>
              </span>
              {row.active ? (
                <Check className="text-aomi-success size-4 shrink-0" />
              ) : hint ? (
                <span
                  data-hint
                  className="type-meta text-aomi-muted pointer-fine:inline hidden shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
