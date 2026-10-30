"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "@/ui/link";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { AomiButton } from "@/ui/aomi/button";
import { AllowanceRing } from "@/ui/aomi/allowance-ring";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SectionHeader } from "@/ui/aomi/section-header";
import { tierLabel, useAccountOverview } from "@/account/account-overview";
import {
  useAccountCreditLedger,
  useAccountCredits,
} from "@/account/use-account-credits";
import { useUsageStatement } from "./use-usage-statement";
import {
  Chip,
  MatrixTable,
  PeriodTotalHero,
  SpendBreakdownSection,
  StatTile,
  USAGE_MATRIX_HINT,
  usd,
} from "./usage-shared";
import type { MonthlyStatement } from "./types";
import { CreditCheckoutDialog } from "./credits/credit-checkout-dialog";
import { PaymentsTable } from "./credits/payments-table";
import {
  billingFromPosition,
  formatDollars,
  type Billing,
} from "./credits/format";

type View = "overview" | "usage" | "payments";
const VIEWS: [View, string][] = [
  ["overview", "Overview"],
  ["usage", "Usage"],
  ["payments", "Payments"],
];

/**
 * Settings › Billing: the monthly allowance and added funds side by side,
 * this month's spend, and payments; Usage keeps the full statement view.
 * Everything is in dollars.
 */
export function BillingSettings({
  initialTopUp = false,
}: { initialTopUp?: boolean } = {}) {
  const [view, setView] = useState<View>("overview");
  const [checkoutOpen, setCheckoutOpen] = useState(initialTopUp);
  const credits = useAccountCredits();
  const ledger = useAccountCreditLedger();
  const refresh = useCallback(async () => {
    await Promise.all([credits.refetch(), ledger.refetch()]);
  }, [credits.refetch, ledger.refetch]);

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Billing view"
        className="border-aomi-border bg-aomi-surface flex h-8 w-max items-center rounded-lg border p-[3px]"
      >
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={cn(
              "rounded-md px-3.5 py-1 text-[12px] leading-none transition-colors",
              view === id
                ? "bg-aomi-surface-2 text-aomi-fg font-medium"
                : "text-aomi-muted hover:text-aomi-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "overview" ? (
        <Overview onAddFunds={() => setCheckoutOpen(true)} onView={setView} />
      ) : view === "usage" ? (
        <UsageView />
      ) : (
        <Payments full />
      )}

      <CreditCheckoutDialog
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onSuccess={refresh}
      />
    </div>
  );
}

function Overview({
  onAddFunds,
  onView,
}: {
  onAddFunds: () => void;
  onView: (view: View) => void;
}) {
  const credits = useAccountCredits();
  const plan = tierLabel(useAccountOverview()?.user.tier);
  const billing = billingFromPosition(credits.data);
  const month = useUsageStatement().month;

  return (
    <>
      {billing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AllowanceCard billing={billing} plan={plan} />
          <BalanceCard billing={billing} onAddFunds={onAddFunds} />
        </div>
      ) : credits.isError ? (
        <p className="text-aomi-danger text-[13px]">
          Couldn’t load your balance.
          <button
            type="button"
            onClick={() => void credits.refetch()}
            className="hover:text-aomi-fg ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </p>
      ) : (
        <LoadingPane label="Loading your balance" className="min-h-36" />
      )}

      {month ? (
        <MonthSoFar month={month} onSeeUsage={() => onView("usage")} />
      ) : null}

      <Payments onSeeAll={() => onView("payments")} />
    </>
  );
}

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-aomi-border bg-aomi-raised rounded-card flex flex-col gap-3.5 border px-[18px] py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="type-section">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function AllowanceCard({ billing, plan }: { billing: Billing; plan: string }) {
  return (
    <Card title="Monthly allowance" aside={<Chip>{`${plan} plan`}</Chip>}>
      {billing.allowanceUsd > 0 ? (
        <div className="flex items-center gap-4 pb-1">
          <AllowanceRing left={billing.allowanceLeft} size={56} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[22px] font-semibold tabular-nums leading-6 tracking-[-0.02em]">
              {formatDollars(billing.allowanceLeftUsd)}{" "}
              <span className="text-aomi-muted text-[13px] font-medium tracking-normal">
                of {formatDollars(billing.allowanceUsd)} left
              </span>
            </span>
            <span className="type-meta text-aomi-muted">
              Resets {billing.resetsOn} · used before your balance
            </span>
          </div>
        </div>
      ) : (
        <p className="type-meta text-aomi-muted pb-1">
          Your plan has no monthly allowance. Usage is paid from your added
          balance.
        </p>
      )}
    </Card>
  );
}

function BalanceCard({
  billing,
  onAddFunds,
}: {
  billing: Billing;
  onAddFunds: () => void;
}) {
  return (
    <Card
      title="Added balance"
      aside={<span className="type-meta text-aomi-muted">Never expires</span>}
    >
      <div className="flex items-end justify-between gap-3 pb-1">
        <div className="flex flex-col gap-1">
          <span className="text-[30px] font-semibold tabular-nums leading-8 tracking-[-0.02em]">
            {formatDollars(billing.balanceUsd)}
          </span>
          <span className="type-meta text-aomi-muted">
            Used once your allowance runs out
          </span>
        </div>
        <AomiButton variant="primary" onClick={onAddFunds}>
          <Plus />
          Add funds
        </AomiButton>
      </div>
    </Card>
  );
}

function MonthSoFar({
  month,
  onSeeUsage,
}: {
  month: MonthlyStatement;
  onSeeUsage: () => void;
}) {
  const turns = month.apps.reduce((sum, app) => sum + app.model.turns, 0);
  const calls = month.apps.reduce(
    (sum, app) => sum + (app.tool?.calls ?? 0),
    0,
  );
  const txns = month.apps.reduce(
    (sum, app) => sum + (app.outcome?.txns ?? 0),
    0,
  );
  const { summary } = month;
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader
        title={`${month.period.periodLabel.split(" ")[0]} so far`}
        detail={`${usd(summary.totalUsd)} spent`}
        action={
          <AomiButton size="sm" onClick={onSeeUsage}>
            See usage
          </AomiButton>
        }
      />
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
        <StatTile
          label="Models"
          value={usd(summary.modelUsd)}
          detail={`${turns} turns`}
        />
        <StatTile
          label="Tool calls"
          value={usd(summary.toolUsd)}
          muted={calls === 0}
          detail={calls ? `${calls} calls` : "No charges"}
        />
        <StatTile
          label="On-chain fees"
          value={usd(summary.onchainUsd)}
          muted={txns === 0}
          detail={
            txns ? `${txns} txn${txns === 1 ? "" : "s"}` : "Settle in-token"
          }
        />
      </div>
    </section>
  );
}

function Payments({
  full = false,
  onSeeAll,
}: {
  full?: boolean;
  onSeeAll?: () => void;
}) {
  const ledger = useAccountCreditLedger();
  const entries = ledger.data?.entries ?? [];
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader
        title="Payments"
        count={entries.length || undefined}
        action={
          onSeeAll && entries.length ? (
            <AomiButton size="sm" onClick={onSeeAll}>
              All payments
            </AomiButton>
          ) : undefined
        }
      />
      {ledger.isPending ? (
        <LoadingPane label="Loading payments" className="min-h-16" />
      ) : ledger.isError ? (
        <p className="text-aomi-danger text-[13px]">
          Couldn’t load payments.
          <button
            type="button"
            onClick={() => void ledger.refetch()}
            className="hover:text-aomi-fg ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </p>
      ) : entries.length ? (
        <PaymentsTable entries={entries} maxHeight={full ? 520 : 254} />
      ) : (
        <p className="border-aomi-border type-meta text-aomi-muted rounded-card border border-dashed px-4 py-3.5">
          No payments yet. Funds you add show up here with their receipts.
        </p>
      )}
    </section>
  );
}

/** The month's statement: total, breakdown, by-app matrix, full statement. */
function UsageView() {
  const statement = useUsageStatement();
  const month = statement.month;
  if (!month) {
    return statement.status === "error" ? (
      <p className="text-aomi-danger text-[13px]">
        {statement.error ?? "Couldn't load usage."}
        <button
          type="button"
          onClick={statement.retry}
          className="hover:text-aomi-fg ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </p>
    ) : (
      <LoadingPane label="Loading usage" />
    );
  }
  return (
    <>
      <PeriodTotalHero
        periodLabel={month.period.periodLabel}
        totalUsd={month.summary.totalUsd}
      />
      <SpendBreakdownSection month={month} />
      {month.apps.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <SectionHeader
            title="By app"
            detail="This period"
            help={USAGE_MATRIX_HINT}
          />
          <div className="border-aomi-border bg-aomi-raised overflow-hidden rounded-xl border px-4 py-3 sm:px-5">
            <MatrixTable month={month} />
          </div>
        </section>
      ) : (
        <p className="text-aomi-muted text-[13px]">No usage this month yet.</p>
      )}
      <Link
        href="/statement"
        className="border-aomi-border bg-aomi-raised hover:bg-aomi-surface-2/40 group flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 transition-colors sm:px-5"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium leading-none">
            Full statement
          </span>
          <span className="text-aomi-muted text-[12px] leading-snug">
            Itemized lines, past months, and filters
          </span>
        </div>
        <ChevronRight
          size={14}
          className="text-aomi-muted group-hover:text-aomi-fg shrink-0 transition-colors"
        />
      </Link>
    </>
  );
}
