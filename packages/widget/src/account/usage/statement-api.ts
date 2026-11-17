"use client";

/**
 * Boundary and aggregation layer for the usage statement.
 *
 * API-server statement rows are immutable raw usage joined to one pricing
 * result. This adapter validates the current contract and builds the shared
 * month/agent view while amounts are still integer micro-USD.
 */

import type { AomiAccount } from "@aomi-labs/client";
import type { AgentUsageEntry, MonthlyStatement } from "./types";

type FundingKind = "platform" | "user_key" | "builder_key";

export type UsageCharge = {
  agentId: number | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  funding: FundingKind;
  grossMicrousd: number;
  includedMicrousd: number;
  creditsMicrousd: number;
};

type AgentAccumulator = {
  usage: AgentUsageEntry;
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

/**
 * Every usage charge of one month, parsed. Cursor pages are inherently
 * serial; 100 is the endpoint's largest page.
 */
export async function fetchStatementCharges(
  monthKey: string,
  account: AomiAccount,
  signal?: AbortSignal,
): Promise<UsageCharge[]> {
  const { from, to } = monthRange(monthKey);
  const start = Date.parse(`${from}T00:00:00Z`) / 1000;
  const end = Date.parse(`${to}T23:59:59Z`) / 1000 + 1;
  const rawRows: unknown[] = [];
  let cursor: string | null = null;
  do {
    const page = await account.statement({
      limit: 100,
      from: start,
      to: end,
      cursor: cursor ?? undefined,
      signal,
    });
    if (!Array.isArray(page.entries)) {
      throw new TypeError(
        "Invalid account statement response: entries must be an array",
      );
    }
    rawRows.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor);
  return rawRows.map(parseUsageCharge);
}

export async function fetchMonthlyStatement(
  monthKey: string,
  account: AomiAccount,
): Promise<MonthlyStatement> {
  const rows = await fetchStatementCharges(monthKey, account);
  return buildMonthlyStatement(monthKey, rows);
}

/** The month/agent view of parsed charges. Unnamed agents fall back to their id. */
export function buildMonthlyStatement(
  monthKey: string,
  rows: readonly UsageCharge[],
  agentNames: ReadonlyMap<number, string> = new Map(),
): MonthlyStatement {
  const { from, to } = monthRange(monthKey);
  const agents = new Map<string, AgentAccumulator>();
  let allowanceAppliedMicrousd = 0;
  let creditBankAppliedMicrousd = 0;

  for (const row of rows) {
    const usd = row.grossMicrousd / 1_000_000;
    const label =
      row.agentId === null
        ? "default"
        : (agentNames.get(row.agentId) ?? `Agent ${row.agentId}`);
    const agent = agents.get(label) ?? createAgentAccumulator(label);
    agent.funding.add(row.funding);
    agent.usage.model.turns += 1;
    agent.usage.model.baseUsd += usd;
    agent.usage.model.chargedUsd += usd;
    agent.usage.agentTotalUsd += usd;

    let model = agent.usage.model.byModel.find(
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
      agent.usage.model.byModel.push(model);
    }
    model.turns += 1;
    model.inputTokens += row.inputTokens;
    model.outputTokens += row.outputTokens;
    model.baseUsd += usd;
    model.chargedUsd += usd;
    agents.set(label, agent);
    allowanceAppliedMicrousd += row.includedMicrousd;
    creditBankAppliedMicrousd += row.creditsMicrousd;
  }

  const agentUsage = [...agents.values()].map(({ usage, funding }) => {
    const ownKeyOnly = [...funding].every(isOwnKeyFunding);
    usage.settings.modelKey = ownKeyOnly ? "byok" : "managed";
    usage.settings.agentByok = ownKeyOnly;
    usage.model.billed = !ownKeyOnly;
    return usage;
  });
  const totalMicrousd = rows.reduce((sum, row) => sum + row.grossMicrousd, 0);
  const totalUsd = totalMicrousd / 1_000_000;
  const settlement = [
    allowanceAppliedMicrousd > 0 ? "monthly allowance" : null,
    creditBankAppliedMicrousd > 0 ? "Credit balance" : null,
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
    agents: agentUsage,
    byAgent: agentUsage.map((agent) => ({
      agent: agent.id,
      modelUsd: agent.model.chargedUsd,
      toolUsd: null,
      outcomeUsd: null,
      totalUsd: agent.agentTotalUsd,
    })),
    columnTotals: {
      modelUsd: totalUsd,
      toolUsd: 0,
      outcomeUsd: 0,
      totalUsd,
    },
  };
}

function createAgentAccumulator(name: string): AgentAccumulator {
  return {
    funding: new Set(),
    usage: {
      id: name,
      name,
      native: name === "default",
      settings: {
        modelKey: "managed",
        agentByok: false,
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
      agentTotalUsd: 0,
    },
  };
}

function parseUsageCharge(value: unknown): UsageCharge {
  const row = statementObject(value, "entry");
  const funding = statementObject(row.funding, "entry.funding");
  const fundingKind = parseFundingKind(funding.kind);

  return {
    agentId: statementNullableNumber(row.agent_id, "agent_id"),
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

function parseFundingKind(value: unknown): FundingKind {
  if (value === "builder_key") {
    return "builder_key";
  }
  if (value === "platform" || value === "user_key") return value;
  throw new TypeError(
    `Invalid account statement response: unsupported funding kind ${String(value)}`,
  );
}

function isOwnKeyFunding(funding: FundingKind): boolean {
  return funding === "user_key" || funding === "builder_key";
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
