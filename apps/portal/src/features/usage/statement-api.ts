"use client";

/**
 * Wire layer for the usage statement.
 *
 * API-server statement rows are immutable raw usage joined to one pricing
 * result. This adapter retains the existing month/app view while the wire
 * boundary is now integer micro-USD and funding-source based.
 */

import { accountScopedFetch } from "@portal/lib/settings-api";
import type {
  AppModelRow,
  AppUsageEntry,
  MonthlyStatement,
  UsagePayment,
} from "./types";

/** One line of the wire statement (backend `ModelStatementLine`). */
export type WireModelLine = {
  model: string;
  provider: string;
  /** `"null"` (tier allowance) / `"byok"` / a stream method (`"coinbase"`, …). */
  payment_method: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  credits_used: number;
  usd: number;
};

export type WireAppStatement = {
  app: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  credits_used: number;
  usd: number;
  by_model: WireModelLine[];
};

export type WirePaymentLeg = {
  method: string;
  credits_used: number;
  usd: number;
  paid_credits: number;
  paid_usd: number;
};

export type WireModelStatement = {
  period_utc_from: string;
  period_utc_to: string;
  apps: WireAppStatement[];
  payment: WirePaymentLeg[];
  total_credits_used: number;
  total_usd: number;
};

type AccountStatementResponse = {
  entries: Array<{
    usage_event_id: string;
    operation_id: string;
    application: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    inference_funding_source: "platform" | "user_byok" | "application_byok";
    gross_charge_microusd: number;
    included_applied_microusd: number;
    bank_debit_microusd: number;
    occurred_at: number;
  }>;
  next_cursor: string | null;
};

export type CreditAllowance = { included: number; used: number };

/** `"YYYY-MM"` month key → the from/to the statement endpoint expects. */
export function monthRange(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` month keys, newest first, current month included. */
export function recentMonthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    keys.push(currentMonthKey(d));
  }
  return keys;
}

export async function fetchModelStatement(
  monthKey: string,
): Promise<WireModelStatement> {
  const { from, to } = monthRange(monthKey);
  const start = Date.parse(`${from}T00:00:00Z`) / 1000;
  const end = Date.parse(`${to}T23:59:59Z`) / 1000 + 1;
  const rows: AccountStatementResponse["entries"] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      limit: "100",
      from: String(start),
      to: String(end),
    });
    if (cursor) query.set("cursor", cursor);
    const page: AccountStatementResponse =
      await accountScopedFetch<AccountStatementResponse>(
        `/v1/account/statement?${query.toString()}`,
      );
    rows.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor);
  const apps = new Map<string, WireAppStatement>();
  const payments = new Map<string, WirePaymentLeg>();
  for (const row of rows) {
    const method = row.inference_funding_source;
    const credits = row.gross_charge_microusd / 10_000;
    const usd = row.gross_charge_microusd / 1_000_000;
    const app = apps.get(row.application) ?? {
      app: row.application,
      turns: 0,
      input_tokens: 0,
      output_tokens: 0,
      credits_used: 0,
      usd: 0,
      by_model: [],
    };
    app.turns += 1;
    app.input_tokens += row.input_tokens;
    app.output_tokens += row.output_tokens;
    app.credits_used += credits;
    app.usd += usd;
    let model = app.by_model.find(
      (line) => line.model === row.model && line.payment_method === method,
    );
    if (!model) {
      model = {
        model: row.model,
        provider: row.provider,
        payment_method: method,
        turns: 0,
        input_tokens: 0,
        output_tokens: 0,
        credits_used: 0,
        usd: 0,
      };
      app.by_model.push(model);
    }
    model.turns += 1;
    model.input_tokens += row.input_tokens;
    model.output_tokens += row.output_tokens;
    model.credits_used += credits;
    model.usd += usd;
    apps.set(row.application, app);
    addPaymentLeg(payments, "included", row.included_applied_microusd);
    addPaymentLeg(payments, "credit_bank", row.bank_debit_microusd);
  }
  const totalMicrousd = rows.reduce(
    (sum, row) => sum + row.gross_charge_microusd,
    0,
  );
  return {
    period_utc_from: from,
    period_utc_to: to,
    apps: [...apps.values()],
    payment: [...payments.values()],
    total_credits_used: totalMicrousd / 10_000,
    total_usd: totalMicrousd / 1_000_000,
  };
}

function addPaymentLeg(
  payments: Map<string, WirePaymentLeg>,
  method: string,
  amountMicrousd: number,
) {
  if (amountMicrousd <= 0) return;
  const leg = payments.get(method) ?? {
    method,
    credits_used: 0,
    usd: 0,
    paid_credits: 0,
    paid_usd: 0,
  };
  leg.credits_used += amountMicrousd / 10_000;
  leg.usd += amountMicrousd / 1_000_000;
  payments.set(method, leg);
}

export async function fetchCreditAllowance(): Promise<CreditAllowance> {
  const position = await accountScopedFetch<{
    included: { limit_microusd: number; used_microusd: number };
  }>("/v1/account/credits?limit=1");
  return {
    included: position.included.limit_microusd / 10_000,
    used: position.included.used_microusd / 10_000,
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[month - 1] ?? monthKey} ${year}`;
}

/** Human label for a payment method wire value. */
export function paymentMethodLabel(method: string): string {
  if (method === "included") return "monthly allowance";
  if (method === "credit_bank") return "Credit Bank";
  if (method === "null" || method === "platform") return "platform funding";
  if (method === "byok" || method === "user_byok") return "your own key";
  if (method === "application_byok") return "application key";
  return method;
}

/**
 * Wire statement + the profile's credit position → the `MonthlyStatement`
 * shape every usage view renders. Only the model subject carries numbers;
 * tool/outcome land as `null` (the types' own "not charged" encoding) and the
 * column totals for those subjects stay 0.
 */
export function toMonthlyStatement(
  wire: WireModelStatement,
  monthKey: string,
  allowance: { included: number; used: number },
): MonthlyStatement {
  const apps: AppUsageEntry[] = wire.apps.map((app) => {
    const byok = app.by_model.every((line) =>
      line.payment_method.endsWith("byok"),
    );
    const byModel: AppModelRow[] = app.by_model.map((line) => ({
      model: line.model,
      provider: line.provider,
      paymentMethod: line.payment_method,
      turns: line.turns,
      inputTokens: line.input_tokens,
      outputTokens: line.output_tokens,
      // No base-vs-markup split on the ledger — charged is the only real
      // number, so base mirrors it rather than inventing a markup.
      baseUsd: line.usd,
      chargedUsd: line.usd,
      ...(line.payment_method.endsWith("byok")
        ? { note: "paid by your own key" }
        : {}),
    }));
    return {
      id: app.app,
      name: app.app,
      native: app.app === "default",
      settings: {
        modelKey: byok ? "byok" : "managed",
        appByok: byok,
        managedMarkupPct: 0,
        note: "",
      },
      model: {
        baseUsd: app.usd,
        markupPct: 0,
        markupUsd: 0,
        chargedUsd: app.usd,
        billed: !byok,
        turns: app.turns,
        byModel,
      },
      tool: null,
      outcome: null,
      appTotalUsd: app.usd,
    };
  });

  const allowanceAppliedUsd =
    wire.payment.find((leg) => leg.method === "included")?.usd ?? 0;
  const creditBankAppliedUsd =
    wire.payment.find((leg) => leg.method === "credit_bank")?.usd ?? 0;
  const settledVia = wire.payment.length
    ? wire.payment.map((leg) => paymentMethodLabel(leg.method)).join(" + ")
    : "your own key";

  const payment: UsagePayment = {
    settledVia,
    allowanceCredits: allowance,
    allowanceAppliedUsd,
    creditBankAppliedUsd,
    onchainUsd: 0,
    onchainNote: "",
  };

  const { from, to } = monthRange(monthKey);
  return {
    period: {
      periodLabel: monthLabel(monthKey),
      from,
      to,
      issued: to,
    },
    summary: {
      modelUsd: wire.total_usd,
      toolUsd: 0,
      outcomeUsd: 0,
      computeUsd: 0,
      onchainUsd: 0,
      totalUsd: wire.total_usd,
      managedMarkupUsd: 0,
    },
    payment,
    apps,
    byApp: wire.apps.map((app) => ({
      app: app.app,
      modelUsd: app.usd,
      toolUsd: null,
      outcomeUsd: null,
      totalUsd: app.usd,
    })),
    columnTotals: {
      modelUsd: wire.total_usd,
      toolUsd: 0,
      outcomeUsd: 0,
      totalUsd: wire.total_usd,
    },
  };
}
