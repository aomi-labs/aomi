"use client";

import { AomiButton } from "@/ui/aomi/button";
import { formatCredits } from "@/account/usage/credit-bank/format";
import { shortAddress } from "@aomi-labs/client";
import type { SheetState } from "./sheet-machine";
import type { SheetFlow } from "./use-sheet-flow";
import {
  BrandMark,
  FootnoteLink,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
} from "./sheet-parts";

function creditsText(value: string): string {
  const credits = Number(value);
  return Number.isFinite(credits) ? formatCredits(credits) : value;
}

function createdOn(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The address the user just signed for already signs in to another account.
 * That signature proves both, so one confirm merges it into this account.
 */
export function MergeStep({
  sheet,
  flow,
}: {
  sheet: Extract<SheetState, { step: "merge" }>;
  flow: SheetFlow;
}) {
  const { other } = sheet.offer;
  const created = createdOn(other.createdAt);
  const stats = [
    { value: other.chats, label: other.chats === 1 ? "chat" : "chats" },
    { value: other.wallets, label: other.wallets === 1 ? "wallet" : "wallets" },
    // A free allowance alone is not worth a "0 credits" line.
    ...(Number(other.credits) > 0
      ? [{ value: creditsText(other.credits), label: "credits" }]
      : []),
  ];
  return (
    <>
      <SheetHeader
        title="Merge accounts"
        description={`${shortAddress(sheet.target.address)} already signs in to another Aomi account.`}
        onClose={flow.close}
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <div className="rounded-card border-aomi-border flex items-center gap-3 border px-3.5 py-3">
          <BrandMark brand={sheet.target.brand} />
          <div className="min-w-0">
            <div className="type-row truncate">{other.name}</div>
            {created ? (
              <div className="type-meta text-aomi-muted">Created {created}</div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-card bg-aomi-surface-2 flex flex-col items-center px-2 py-2.5"
            >
              <span className="type-title tabular-nums">{stat.value}</span>
              <span className="type-meta text-aomi-muted">{stat.label}</span>
            </div>
          ))}
        </div>
        <p className="type-meta text-aomi-muted">
          Everything moves into the account you’re signed in to. The other
          account closes, and its wallets sign you in here.
        </p>
        {other.dropped.length ? (
          <p className="rounded-control bg-aomi-surface-2 type-meta text-aomi-muted px-3 py-2">
            Won’t move:{" "}
            <span className="text-aomi-fg font-medium">
              {other.dropped.join(", ")}
            </span>
            . This account already has{" "}
            {other.dropped.length === 1 ? "one" : "these"}.
          </p>
        ) : null}
        {flow.error ? <SheetAlert>{flow.error}</SheetAlert> : null}
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={flow.busy}
          onClick={() => void flow.merge()}
        >
          {flow.busy ? "Merging…" : "Merge into this account"}
        </AomiButton>
        <SheetFootnote>
          <FootnoteLink onClick={() => void flow.switchInstead()}>
            Switch to that account instead
          </FootnoteLink>
        </SheetFootnote>
      </div>
    </>
  );
}
