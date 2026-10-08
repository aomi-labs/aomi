import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { shortAddress } from "@aomi-labs/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import type { WalletFamily } from "@/wallet/types";
import { PendingMark } from "@/ui/aomi/status-pill";
import { BrandMark } from "./controls";
import {
  appName,
  familySlots,
  familyTag,
  pendingHint,
  rowEmail,
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
  onAddWallet,
}: {
  rows: readonly WalletRow[];
  disabled: boolean;
  onActivate?: (row: WalletRow) => void;
  onAddWallet?: () => void;
}) {
  return (
    <div className="divide-aomi-border grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      {familySlots(rows).map((slot) =>
        slot.current ? (
          <FamilySlot
            key={slot.family}
            family={slot.family}
            rows={slot.rows}
            current={slot.current}
            disabled={disabled}
            onActivate={onActivate}
            onAddWallet={onAddWallet}
          />
        ) : (
          <EmptySlot
            key={slot.family}
            family={slot.family}
            disabled={disabled}
            onAddWallet={onAddWallet}
          />
        ),
      )}
    </div>
  );
}

/** A family with no address: the same slot, muted, offering to add one. */
function EmptySlot({
  family,
  disabled,
  onAddWallet,
}: {
  family: WalletFamily;
  disabled: boolean;
  onAddWallet?: () => void;
}) {
  const tag = familyTag(family);
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="type-meta text-aomi-muted flex items-center gap-1.5">
          <FamilyTag family={family} />
          signs with
        </span>
        <span className="type-control text-aomi-muted flex items-center gap-1.5 truncate">
          {onAddWallet ? <Plus className="size-3.5 shrink-0" /> : null}
          {onAddWallet ? `Add ${tag} wallet` : `No ${tag} wallet`}
        </span>
      </span>
    </>
  );
  const className = "flex min-w-0 items-center gap-2 px-3.5 py-2.5 text-left";
  if (!onAddWallet) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      aria-label={`Add ${tag} wallet`}
      disabled={disabled}
      onClick={onAddWallet}
      className={cn(
        className,
        "hover:bg-aomi-hover focus-visible:bg-aomi-hover outline-none transition-colors",
      )}
    >
      {body}
    </button>
  );
}

function FamilySlot({
  family,
  rows,
  current,
  disabled,
  onActivate,
  onAddWallet,
}: {
  family: WalletFamily;
  rows: WalletRow[];
  current: WalletRow;
  disabled: boolean;
  onActivate?: (row: WalletRow) => void;
  onAddWallet?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const tag = familyTag(family);
  const hint = current.active ? null : pendingHint(current);
  // Nothing signs here yet: the slot shows the chosen address waiting for its
  // step, and clicking it does that step, like its row below.
  if (!current.active && hint && onActivate)
    return (
      <button
        type="button"
        aria-label={`${hint} (${tag} ${rowTitle(current).title})`}
        disabled={disabled}
        onClick={() => onActivate(current)}
        className="hover:bg-aomi-hover focus-visible:bg-aomi-hover group flex min-w-0 items-center gap-2 px-3.5 py-2.5 text-left outline-none transition-colors"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-meta text-aomi-muted flex items-center gap-1.5">
            <FamilyTag family={family} />
            signs with
          </span>
          <span className="flex min-w-0 items-center gap-1.5 opacity-60">
            <BrandMark
              brand={appName(current)}
              dot={current.connected ? "on" : "off"}
              size={13}
              box={16}
            />
            <span className="type-control truncate font-medium">
              {rowTitle(current).title}
              <span className="text-aomi-muted font-normal">
                {" · "}
                <span className="font-mono">
                  {shortAddress(current.address)}
                </span>
                {rowEmail(current) ? ` · ${rowEmail(current)}` : null}
              </span>
            </span>
          </span>
        </span>
        {current.activating ? (
          <PendingMark />
        ) : (
          <span
            data-hint
            className="type-meta text-aomi-muted pointer-fine:inline-flex pointer-events-none hidden shrink-0 items-center gap-0.5 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {hint}
            <ChevronRight className="size-3" />
          </span>
        )}
      </button>
    );
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
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                !current.active && !current.connected && "opacity-60",
              )}
            >
              <BrandMark brand={appName(current)} size={13} box={16} />
              <span className="type-control truncate font-medium">
                {rowTitle(current).title}
                <span className="text-aomi-muted font-normal">
                  {" · "}
                  <span className="font-mono">
                    {shortAddress(current.address)}
                  </span>
                  {rowEmail(current) ? ` · ${rowEmail(current)}` : null}
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
                  {rowEmail(row) ? (
                    <span className="font-sans"> · {rowEmail(row)}</span>
                  ) : null}
                </span>
              </span>
              {row.active ? (
                <Check className="text-aomi-success size-4 shrink-0" />
              ) : row.activating ? (
                <PendingMark className="mx-px" />
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
        {onAddWallet ? (
          <>
            <div role="separator" className="bg-aomi-border my-1 h-px" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAddWallet();
              }}
              className="hover:bg-aomi-hover focus:bg-aomi-hover type-control flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left outline-none"
            >
              <span className="flex size-7 shrink-0 items-center justify-center">
                <Plus className="text-aomi-muted size-4" />
              </span>
              Add a wallet
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
