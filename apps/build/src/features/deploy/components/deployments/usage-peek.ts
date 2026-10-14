export type UsagePeek = {
  creditsUsed: number;
  tokens: number;
  available: boolean;
  dayCount: number;
  /** Normalized 0–1 bars for a compact spark (newest last). */
  spark: number[];
};

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Compact token/credit counts for the Home glance. */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return value < 10 ? value.toFixed(value % 1 ? 2 : 0) : String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

/**
 * Summarize operate usage daily rows for the project Home card.
 * Clarify only — same feed as Operate → Usage.
 */
export function summarizeProjectUsage(payload: {
  daily?: Array<Record<string, unknown>>;
} | null): UsagePeek {
  if (!payload) {
    return {
      creditsUsed: 0,
      tokens: 0,
      available: false,
      dayCount: 0,
      spark: [],
    };
  }

  const daily = payload.daily ?? [];
  const totals = daily.reduce<{ creditsUsed: number; tokens: number }>(
    (acc, row) => ({
      creditsUsed: acc.creditsUsed + numberValue(row.creditsUsed),
      tokens:
        acc.tokens +
        numberValue(row.inputTokens) +
        numberValue(row.outputTokens),
    }),
    { creditsUsed: 0, tokens: 0 },
  );

  const byDay = new Map<string, number>();
  for (const row of daily) {
    const day = String(row.periodUtcDay ?? "").trim();
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + numberValue(row.creditsUsed));
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const slice = days.slice(-7);
  const max = Math.max(...slice.map(([, v]) => v), 0);
  const spark =
    slice.length === 0
      ? []
      : max <= 0
        ? slice.map(() => 0)
        : slice.map(([, v]) => v / max);

  return {
    ...totals,
    available: true,
    dayCount: byDay.size,
    spark,
  };
}
