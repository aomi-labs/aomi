import type { CreditBalance } from "@aomi-labs/client";

export function formatCredits(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Every billing surface shows dollars, to the cent. */
export function formatDollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** The account's money: the monthly allowance first, then added funds. */
export type Billing = {
  allowanceUsd: number;
  allowanceLeftUsd: number;
  /** Fraction of the allowance left, 0–1; 0 without an allowance. */
  allowanceLeft: number;
  balanceUsd: number;
  /** Allowance left plus added funds. */
  availableUsd: number;
  /** When the allowance refills, e.g. "Nov 1". */
  resetsOn: string;
};

export function billingFromPosition(
  position: Partial<CreditBalance> | null | undefined,
): Billing | null {
  if (!position || (!position.included && position.balance_microusd == null))
    return null;
  const limit = position.included?.limit_microusd ?? 0;
  const used = position.included?.used_microusd ?? 0;
  const allowanceUsd = limit / 1_000_000;
  const allowanceLeftUsd = Math.max(0, limit - used) / 1_000_000;
  const balanceUsd = Math.max(0, position.balance_microusd ?? 0) / 1_000_000;
  return {
    allowanceUsd,
    allowanceLeftUsd,
    allowanceLeft: allowanceUsd > 0 ? allowanceLeftUsd / allowanceUsd : 0,
    balanceUsd,
    availableUsd: allowanceLeftUsd + balanceUsd,
    resetsOn: nextMonthStart(position.period_utc_month),
  };
}

function nextMonthStart(period?: string): string {
  const now = new Date();
  const [year, month] = period?.split("-").map(Number) ?? [
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
  ];
  return new Date(Date.UTC(year!, month!, 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
