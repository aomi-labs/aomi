"use client";

import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { useUsageStatement } from "./use-usage-statement";
import {
  AllowanceSettlementSection,
  MatrixTable,
  PeriodTotalHero,
  SectionHeading,
  SpendBreakdownSection,
  USAGE_MATRIX_HINT,
} from "./usage-shared";
import { CreditBank } from "./credit-bank";

/**
 * Settings › Usage — design-sync hierarchy (hero, spend breakdown, allowance,
 * by-app matrix) on the live model statement (`/v1/account/statement`).
 * Tool and on-chain subjects show "—" until their ledger writers exist.
 */
export function UsageSettings() {
  const statement = useUsageStatement();
  const month = statement.month;

  if (!month) {
    return (
      <div className="mx-auto w-full max-w-[780px] px-6 py-6">
        {statement.status === "error" ? (
          <p className="text-aomi-danger text-[13px]">
            {statement.error ?? "Couldn't load usage."}
            <button
              onClick={statement.retry}
              className="hover:text-aomi-fg ml-2 underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : (
          <p className="text-aomi-muted flex items-center gap-2 text-[13px]">
            <Loader2 size={14} className="animate-spin" />
            Loading usage…
          </p>
        )}
      </div>
    );
  }

  const { period } = month;
  const hasAllowance =
    statement.isCurrentMonth && month.payment.allowanceCredits.included > 0;

  return (
    <div className="mx-auto w-full max-w-[780px] px-6 py-6">
      <div className="flex flex-col gap-5">
        <PeriodTotalHero
          periodLabel={period.periodLabel}
          totalUsd={month.summary.totalUsd}
        />

        <SpendBreakdownSection month={month} />

        <AllowanceSettlementSection month={month} showAllowance={hasAllowance}>
          <CreditBank />
        </AllowanceSettlementSection>

        {month.apps.length > 0 ? (
          <section className="flex flex-col gap-2.5">
            <SectionHeading title="By app" hint={USAGE_MATRIX_HINT} />
            <div className="border-aomi-border bg-aomi-raised overflow-hidden rounded-xl border px-4 py-3 sm:px-5">
              <MatrixTable month={month} />
            </div>
          </section>
        ) : (
          <p className="text-aomi-muted text-[13px]">
            No usage this month yet.
          </p>
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
          <ChevronDown
            size={14}
            className="text-aomi-muted group-hover:text-aomi-fg shrink-0 -rotate-90 transition-colors"
          />
        </Link>
      </div>
    </div>
  );
}
