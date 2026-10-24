"use client";

import { useCallback, useState } from "react";
import { LoadingLine, LoadingPane } from "@/ui/aomi/loading-pane";
import { type CreditLedgerEntry } from "@aomi-labs/client";
import {
  useAccountCredits,
  useAccountCreditLedger,
} from "@/account/use-account-credits";
import { CreditCheckoutDialog } from "./credit-checkout-dialog";
import { formatCreditAmount, formatUsd, toCredits } from "./format";
import {
  ChevronDown,
  Coins,
  ExternalLink,
  Plus,
  ReceiptText,
} from "lucide-react";

export function CreditBalancePanel({
  initialTopUp = false,
}: { initialTopUp?: boolean } = {}) {
  const creditQuery = useAccountCredits();
  const [open, setOpen] = useState(initialTopUp);
  const [reviewOpen, setReviewOpen] = useState(initialTopUp);
  const ledgerQuery = useAccountCreditLedger(open);
  const ledger = ledgerQuery.data;
  const position = creditQuery.data ?? null;
  const loading = creditQuery.isPending;
  const error = creditQuery.error?.message ?? ledgerQuery.error?.message;
  const load = useCallback(async () => {
    await Promise.all([creditQuery.refetch(), ledgerQuery.refetch()]);
  }, [creditQuery.refetch, ledgerQuery.refetch]);
  const balance = position ? toCredits(position.balance_microusd) : null;

  return (
    <div className="border-aomi-border border-t">
      <button
        type="button"
        aria-expanded={open}
        className="hover:bg-aomi-surface-2/40 focus-visible:ring-aomi-accent/40 flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset sm:px-5"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="border-aomi-border bg-aomi-surface-2 text-aomi-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border">
            <Coins size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="text-aomi-fg block text-[13px] font-medium">
              Credit balance
            </span>
            <span className="text-aomi-muted block truncate text-[11px]">
              Purchased balance · never expires
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-right">
            <span className="text-aomi-fg block text-[13px] font-medium tabular-nums">
              {loading && !position ? (
                <LoadingLine className="w-12" />
              ) : balance === null ? (
                "—"
              ) : (
                formatCreditAmount(balance)
              )}
            </span>
            <span className="text-aomi-muted block text-[11px] tabular-nums">
              {loading && !position ? (
                <LoadingLine className="h-[11px] w-14" />
              ) : balance === null ? (
                "Unavailable"
              ) : (
                `${formatUsd(balance / 100)} value`
              )}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            size={15}
            className={`text-aomi-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open ? (
        <div className="border-aomi-border bg-aomi-surface/25 flex flex-col gap-4 border-t px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-aomi-fg text-[13px] font-medium">
                Keep usage moving
              </p>
              <p className="text-aomi-muted mt-0.5 max-w-md text-[12px] leading-relaxed">
                Add permanent credits by card or USDC. Purchased credits are
                used after your monthly allowance.
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setReviewOpen(true);
              }}
              className="bg-aomi-fg text-aomi-bg focus-visible:ring-aomi-accent/50 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <Plus size={14} aria-hidden="true" />
              Add credits
            </button>
          </div>

          {error && !reviewOpen ? (
            <div
              role="alert"
              className="border-aomi-danger/25 bg-aomi-danger/5 text-aomi-danger rounded-lg border px-3 py-2.5 text-xs"
            >
              {error}{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="underline"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="border-aomi-border border-t pt-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="text-aomi-fg text-[12px] font-medium">
                Recent activity
              </h3>
              {ledger?.entries.length ? (
                <span className="text-aomi-muted text-[11px]">
                  Latest {ledger.entries.length}
                </span>
              ) : null}
            </div>
            {ledgerQuery.isPending ? (
              <LoadingPane
                label="Loading recent activity"
                className="min-h-16"
              />
            ) : null}
            {ledger?.entries.length === 0 ? (
              <div className="border-aomi-border bg-aomi-bg/40 flex items-center gap-3 rounded-lg border border-dashed px-3 py-3">
                <ReceiptText
                  size={15}
                  className="text-aomi-muted shrink-0"
                  aria-hidden="true"
                />
                <p className="text-aomi-muted text-xs">
                  No purchased-credit activity yet.
                </p>
              </div>
            ) : null}
            {ledger?.entries.length ? (
              <div
                className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-lg border"
                role="list"
                aria-label="Recent credit activity"
              >
                {ledger.entries.map((entry) => (
                  <CreditActivityRow entry={entry} key={entry.id} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <CreditCheckoutDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onSuccess={load}
      />
    </div>
  );
}

function CreditActivityRow({ entry }: { entry: CreditLedgerEntry }) {
  const receiptUrl = creditReceiptUrl(entry);
  const amountCredits = Math.abs(toCredits(entry.amount_microusd));
  const amountUsd = Math.abs(entry.amount_microusd) / 1_000_000;
  const isCredit = entry.amount_microusd > 0;
  const details = [
    formatCreditDate(entry.created_at),
    entry.entry_kind === "purchase" &&
    (entry.payment_provider || entry.payment_method)
      ? creditPaymentLabel(entry)
      : null,
    entry.application_id ? `Application ${entry.application_id}` : null,
  ].filter(Boolean);

  return (
    <div
      role="listitem"
      className="bg-aomi-bg/30 flex items-center gap-3 px-3 py-3"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isCredit
            ? "bg-aomi-success/10 text-aomi-success"
            : "bg-aomi-surface-2 text-aomi-muted"
        }`}
      >
        {isCredit ? (
          <Plus size={14} aria-hidden="true" />
        ) : (
          <ReceiptText size={14} aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-aomi-fg truncate text-[12px] font-medium">
          {creditActivityLabel(entry.entry_kind)}
        </p>
        <p className="text-aomi-muted mt-0.5 truncate text-[10px]">
          {details.join(" · ")}
        </p>
        {receiptUrl ? (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-aomi-accent mt-1 inline-flex items-center gap-1 text-[10px] hover:underline"
          >
            View receipt
            <ExternalLink size={9} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`text-[12px] font-medium tabular-nums ${
            isCredit ? "text-aomi-success" : "text-aomi-fg"
          }`}
        >
          {isCredit ? "+" : "−"}
          {formatCreditAmount(amountCredits)}
        </p>
        <p className="text-aomi-muted mt-0.5 text-[10px] tabular-nums">
          {entry.entry_kind === "purchase"
            ? `${formatUsd(amountUsd)} paid`
            : formatUsd(amountUsd)}
        </p>
      </div>
    </div>
  );
}

function formatCreditDate(timestamp: number): string {
  const milliseconds = timestamp * 1000;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(milliseconds));
}

function creditReceiptUrl(entry: CreditLedgerEntry): string | null {
  if (entry.payment_method !== "wallet") return null;
  const transaction = entry.metadata?.transaction;
  if (
    typeof transaction !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(transaction)
  ) {
    return null;
  }
  const network = entry.metadata?.payment_network;
  if (typeof network !== "string") return null;
  const explorer = explorerForPaymentNetwork(network);
  return explorer ? `${explorer}/tx/${transaction}` : null;
}

function explorerForPaymentNetwork(network: string): string | null {
  return (
    (
      {
        "eip155:8453": "https://basescan.org",
        "eip155:84532": "https://sepolia.basescan.org",
        "eip155:1": "https://etherscan.io",
        "eip155:42161": "https://arbiscan.io",
        "eip155:10": "https://optimistic.etherscan.io",
      } as Record<string, string>
    )[network] ?? null
  );
}

function creditPaymentLabel(entry: CreditLedgerEntry): string {
  return entry.payment_method === "card" ? "Card payment" : "USDC payment";
}

function creditActivityLabel(kind: string): string {
  if (kind === "purchase") return "Credits added";
  if (kind === "usage_debit") return "Personal usage";
  if (kind === "builder_charge") return "Builder charge";
  if (kind === "refund") return "Refund";
  if (kind === "dispute") return "Dispute";
  if (kind === "reinstatement") return "Reinstatement";
  return "Credit adjustment";
}
