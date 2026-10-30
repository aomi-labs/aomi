"use client";

import type { CreditLedgerEntry } from "@aomi-labs/client";
import { CreditCard, ExternalLink, ReceiptText, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDollars } from "./format";

const NETWORKS: Record<string, { name: string; explorer: string }> = {
  "eip155:1": { name: "Ethereum", explorer: "https://etherscan.io" },
  "eip155:10": {
    name: "Optimism",
    explorer: "https://optimistic.etherscan.io",
  },
  "eip155:8453": { name: "Base", explorer: "https://basescan.org" },
  "eip155:84532": {
    name: "Base Sepolia",
    explorer: "https://sepolia.basescan.org",
  },
  "eip155:42161": { name: "Arbitrum", explorer: "https://arbiscan.io" },
};

const COLS =
  "grid-cols-[64px_minmax(0,1fr)_minmax(0,140px)_80px_76px_28px] gap-3";

/** Top-ups, refunds and balance usage, newest first, in a scrolling table. */
export function PaymentsTable({
  entries,
  maxHeight = 254,
}: {
  entries: CreditLedgerEntry[];
  maxHeight?: number;
}) {
  return (
    <div className="border-aomi-border bg-aomi-raised rounded-card overflow-hidden border">
      <div className="overflow-auto" style={{ maxHeight }}>
        <div className="min-w-[560px]" role="table" aria-label="Payments">
          <div
            role="row"
            className={cn(
              "border-aomi-border bg-aomi-surface text-aomi-muted sticky top-0 grid h-9 items-center border-b px-4 text-[12px] font-medium",
              COLS,
            )}
          >
            <span role="columnheader">Date</span>
            <span role="columnheader">Description</span>
            <span role="columnheader">Method</span>
            <span role="columnheader" className="text-right">
              Amount
            </span>
            <span role="columnheader">Status</span>
            <span role="columnheader" aria-label="Link" />
          </div>
          <div className="divide-aomi-border divide-y">
            {entries.map((entry) => (
              <PaymentRow entry={entry} key={entry.id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentRow({ entry }: { entry: CreditLedgerEntry }) {
  const network = paymentNetwork(entry);
  const txUrl = transactionUrl(entry, network);
  const added = entry.amount_microusd > 0;
  const refunded = entry.entry_kind === "refund";
  const Icon =
    entry.payment_method === "wallet"
      ? Wallet
      : entry.payment_method === "card"
        ? CreditCard
        : ReceiptText;
  return (
    <div
      role="row"
      className={cn("grid h-11 items-center px-4 text-[13px]", COLS)}
    >
      <span className="text-aomi-muted tabular-nums">
        {new Date(entry.created_at * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })}
      </span>
      <span className="truncate">{description(entry.entry_kind)}</span>
      <span className="text-aomi-muted flex min-w-0 items-center gap-1.5">
        <Icon size={14} className="shrink-0" aria-hidden />
        <span className="truncate">
          {entry.payment_method === "wallet"
            ? `USDC${network ? ` · ${network.name}` : ""}`
            : entry.payment_method === "card"
              ? "Card"
              : "From balance"}
        </span>
      </span>
      <span
        className={cn(
          "text-right font-medium tabular-nums",
          refunded && "text-aomi-muted",
        )}
      >
        {added ? "" : "−"}
        {formatDollars(Math.abs(entry.amount_microusd) / 1_000_000)}
      </span>
      <span>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-wide",
            entry.entry_kind === "purchase"
              ? "border-aomi-success/25 bg-aomi-success/10 text-aomi-success"
              : "border-aomi-border bg-aomi-surface-2 text-aomi-muted",
          )}
        >
          {status(entry.entry_kind)}
        </span>
      </span>
      {txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="View transaction"
          className="text-aomi-muted hover:text-aomi-fg flex size-7 items-center justify-center rounded-[8px] transition-colors"
        >
          <ExternalLink size={14} />
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

function description(kind: string): string {
  if (kind === "purchase") return "Added funds";
  if (kind === "usage_debit") return "Used past allowance";
  if (kind === "builder_charge") return "Builder charge";
  if (kind === "refund") return "Refund";
  if (kind === "dispute") return "Dispute";
  if (kind === "reinstatement") return "Reinstatement";
  return "Adjustment";
}

function status(kind: string): string {
  if (kind === "purchase") return "Paid";
  if (kind === "refund") return "Refunded";
  if (kind === "dispute") return "Disputed";
  return "Usage";
}

function paymentNetwork(entry: CreditLedgerEntry) {
  const network = entry.metadata?.payment_network;
  return typeof network === "string" ? NETWORKS[network] : undefined;
}

function transactionUrl(
  entry: CreditLedgerEntry,
  network: (typeof NETWORKS)[string] | undefined,
): string | null {
  const transaction = entry.metadata?.transaction;
  if (
    entry.payment_method !== "wallet" ||
    !network ||
    typeof transaction !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(transaction)
  ) {
    return null;
  }
  return `${network.explorer}/tx/${transaction}`;
}
