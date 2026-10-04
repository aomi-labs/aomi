"use client";

/**
 * Boundary and aggregation layer for the usage statement.
 *
 * API-server statement rows are immutable raw usage joined to one pricing
 * result. This adapter validates the current contract and builds the shared
 * month/app view while amounts are still integer micro-USD.
 */

import type { ShellRequest } from "../../transport";
import { MICROUSD_PER_CREDIT } from "@aomi-labs/client";
import { accountScopedFetch } from "../../lib/settings-api";
import type { CreditAllowance } from "../../lib/account-overview";
import type { AppUsageEntry, MonthlyStatement } from "./types";

type AccountStatementResponse = {
  entries: unknown[];
  next_cursor: string | null;
};

type FundingKind = "platform" | "user_key" | "application_key";

type UsageCharge = {
  applicationId: number | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  funding: FundingKind;
  grossMicrousd: number;
  includedMicrousd: number;
  creditsMicrousd: number;
};

type AppAccumulator = {
  usage: AppUsageEntry;
  funding: Set<FundingKind>;
};

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

export async function fetchMonthlyStatement(
  monthKey: string,
  request: ShellRequest = accountScopedFetch,
): Promise<MonthlyStatement> {
  const { from, to } = monthRange(monthKey);
  const start = Date.parse(`${from}T00:00:00Z`) / 1000;
  const end = Date.parse(`${to}T23:59:59Z`) / 1000 + 1;
  const rawRows: AccountStatementResponse["entries"] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      limit: "100",
      from: String(start),
      to: String(end),
    });
    if (cursor) query.set("cursor", cursor);
    const page: AccountStatementResponse =
      await request<AccountStatementResponse>(
        `/v1/account/statement?${query.toString()}`,
      );
    if (!Array.isArray(page.entries)) {
      throw new TypeError(
        "Invalid account statement response: entries must be an array",
      );
    }
    rawRows.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor);
  const rows = rawRows.map(parseUsageCharge);
  const applicationNames = await fetchApplicationNames(rows, request);
  const apps = new Map<string, AppAccumulator>();
  let allowanceAppliedMicrousd = 0;
  let creditBankAppliedMicrousd = 0;

  for (const row of rows) {
    const usd = row.grossMicrousd / 1_000_000;
    const application =
      row.applicationId === null
        ? "default"
        : (applicationNames.get(row.applicationId) ??
          `Application ${row.applicationId}`);
    const app = apps.get(application) ?? createAppAccumulator(application);
    app.funding.add(row.funding);
    app.usage.model.turns += 1;
    app.usage.model.baseUsd += usd;
    app.usage.model.chargedUsd += usd;
    app.usage.appTotalUsd += usd;

    let model = app.usage.model.byModel.find(
      (line) =>
        line.provider === row.provider &&
        line.model === row.model &&
        line.paymentMethod === row.funding,
    );
    if (!model) {
      model = {
        model: row.model,
        provider: row.provider,
        paymentMethod: row.funding,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        baseUsd: 0,
        chargedUsd: 0,
        ...(isOwnKeyFunding(row.funding)
          ? { note: "paid by your own key" }
          : {}),
      };
      app.usage.model.byModel.push(model);
    }
    model.turns += 1;
    model.inputTokens += row.inputTokens;
    model.outputTokens += row.outputTokens;
    model.baseUsd += usd;
    model.chargedUsd += usd;
    apps.set(application, app);
    allowanceAppliedMicrousd += row.includedMicrousd;
    creditBankAppliedMicrousd += row.creditsMicrousd;
  }

  const appUsage = [...apps.values()].map(({ usage, funding }) => {
    const ownKeyOnly = [...funding].every(isOwnKeyFunding);
    usage.settings.modelKey = ownKeyOnly ? "byok" : "managed";
    usage.settings.appByok = ownKeyOnly;
    usage.model.billed = !ownKeyOnly;
    return usage;
  });
  const totalMicrousd = rows.reduce((sum, row) => sum + row.grossMicrousd, 0);
  const totalUsd = totalMicrousd / 1_000_000;
  const settlement = [
    allowanceAppliedMicrousd > 0 ? "monthly allowance" : null,
    creditBankAppliedMicrousd > 0 ? "Credit Bank" : null,
  ].filter((method): method is string => method !== null);

  return {
    period: {
      periodLabel: monthLabel(monthKey),
      from,
      to,
      issued: to,
    },
    summary: {
      modelUsd: totalUsd,
      toolUsd: 0,
      outcomeUsd: 0,
      computeUsd: totalUsd,
      onchainUsd: 0,
      totalUsd,
      managedMarkupUsd: 0,
    },
    payment: {
      settledVia: settlement.length ? settlement.join(" + ") : "your own key",
      allowanceCredits: { included: 0, used: 0 },
      allowanceAppliedUsd: allowanceAppliedMicrousd / 1_000_000,
      creditBankAppliedUsd: creditBankAppliedMicrousd / 1_000_000,
      onchainUsd: 0,
      onchainNote: "",
    },
    apps: appUsage,
    byApp: appUsage.map((app) => ({
      app: app.id,
      modelUsd: app.model.chargedUsd,
      toolUsd: null,
      outcomeUsd: null,
      totalUsd: app.appTotalUsd,
    })),
    columnTotals: {
      modelUsd: totalUsd,
      toolUsd: 0,
      outcomeUsd: 0,
      totalUsd,
    },
  };
}

function createAppAccumulator(name: string): AppAccumulator {
  return {
    funding: new Set(),
    usage: {
      id: name,
      name,
      native: name === "default",
      settings: {
        modelKey: "managed",
        appByok: false,
        managedMarkupPct: 0,
        note: "",
      },
      model: {
        baseUsd: 0,
        markupPct: 0,
        markupUsd: 0,
        chargedUsd: 0,
        billed: true,
        turns: 0,
        byModel: [],
      },
      tool: null,
      outcome: null,
      appTotalUsd: 0,
    },
  };
}

function parseUsageCharge(value: unknown): UsageCharge {
  const row = statementObject(value, "entry");
  const funding = statementObject(row.funding, "entry.funding");
  const fundingKind = funding.kind;
  if (
    fundingKind !== "platform" &&
    fundingKind !== "user_key" &&
    fundingKind !== "application_key"
  ) {
    throw new TypeError(
      `Invalid account statement response: unsupported funding kind ${String(fundingKind)}`,
    );
  }

  return {
    applicationId: statementNullableNumber(
      row.application_id,
      "application_id",
    ),
    provider: statementString(row.provider, "provider"),
    model: statementString(row.model, "model"),
    inputTokens: statementNumber(row.input_tokens, "input_tokens"),
    outputTokens: statementNumber(row.output_tokens, "output_tokens"),
    funding: fundingKind,
    grossMicrousd: statementNumber(row.gross, "gross"),
    includedMicrousd: statementNumber(row.included, "included"),
    creditsMicrousd: statementNumber(row.credits, "credits"),
  };
}

function isOwnKeyFunding(funding: FundingKind): boolean {
  return funding === "user_key" || funding === "application_key";
}

async function fetchApplicationNames(
  rows: UsageCharge[],
  request: ShellRequest,
): Promise<Map<number, string>> {
  if (!rows.some((row) => row.applicationId !== null)) return new Map();
  try {
    const apps = await request<unknown[]>("/api/account/apps");
    const names = new Map<number, string>();
    for (const value of apps) {
      const app = statementObject(value, "application");
      const id = app.application_id;
      if (
        typeof id === "number" &&
        Number.isSafeInteger(id) &&
        typeof app.name === "string" &&
        app.name.trim()
      ) {
        names.set(id, app.name.trim());
      }
    }
    return names;
  } catch {
    return new Map();
  }
}

function statementObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Invalid account statement response: ${field} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function statementString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(
      `Invalid account statement response: ${field} must be a string`,
    );
  }
  return value;
}

function statementNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(
      `Invalid account statement response: ${field} must be a safe integer`,
    );
  }
  return value;
}

function statementNullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return statementNumber(value, field);
}

export async function fetchCreditAllowance(
  request: ShellRequest = accountScopedFetch,
): Promise<CreditAllowance> {
  const position = statementObject(
    await request<unknown>("/v1/account/credits?limit=1"),
    "account credits",
  );
  return {
    included:
      statementNumber(position.included_limit, "included_limit") /
      MICROUSD_PER_CREDIT,
    used:
      statementNumber(position.included_used, "included_used") /
      MICROUSD_PER_CREDIT,
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
