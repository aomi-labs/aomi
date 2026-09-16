import { accountScopedFetch } from "@portal/lib/settings-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchModelStatement,
  monthRange,
  recentMonthKeys,
  toMonthlyStatement,
  type WireModelStatement,
} from "./statement-api";

vi.mock("@portal/lib/settings-api", () => ({ accountScopedFetch: vi.fn() }));

const fetchMock = vi.mocked(accountScopedFetch);

const WIRE: WireModelStatement = {
  period_utc_from: "2026-07-01",
  period_utc_to: "2026-07-31",
  apps: [
    {
      app: "default",
      turns: 12,
      input_tokens: 4000,
      output_tokens: 900,
      credits_used: 120,
      usd: 1.2,
      by_model: [
        {
          model: "claude-sonnet-5",
          provider: "anthropic",
          payment_method: "null",
          turns: 10,
          input_tokens: 3600,
          output_tokens: 700,
          credits_used: 100,
          usd: 1.0,
        },
        {
          model: "claude-haiku-4-5",
          provider: "anthropic",
          payment_method: "coinbase",
          turns: 2,
          input_tokens: 400,
          output_tokens: 200,
          credits_used: 20,
          usd: 0.2,
        },
      ],
    },
    {
      app: "uniswap",
      turns: 3,
      input_tokens: 800,
      output_tokens: 150,
      credits_used: 30,
      usd: 0.3,
      by_model: [
        {
          model: "claude-sonnet-5",
          provider: "anthropic",
          payment_method: "byok",
          turns: 3,
          input_tokens: 800,
          output_tokens: 150,
          credits_used: 30,
          usd: 0.3,
        },
      ],
    },
  ],
  payment: [
    {
      method: "included",
      credits_used: 100,
      usd: 1.0,
      paid_credits: 0,
      paid_usd: 0,
    },
    {
      method: "credit_bank",
      credits_used: 20,
      usd: 0.2,
      paid_credits: 20,
      paid_usd: 0.2,
    },
    {
      method: "byok",
      credits_used: 30,
      usd: 0.3,
      paid_credits: 0,
      paid_usd: 0,
    },
  ],
  total_credits_used: 150,
  total_usd: 1.5,
};

describe("statement adapter", () => {
  beforeEach(() => fetchMock.mockReset());

  it("computes month ranges including leap/short months", () => {
    expect(monthRange("2026-07")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(monthRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(monthRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("lists recent months newest first across a year boundary", () => {
    const keys = recentMonthKeys(3, new Date(Date.UTC(2026, 0, 15)));
    expect(keys).toEqual(["2026-01", "2025-12", "2025-11"]);
  });

  it("maps the wire statement onto MonthlyStatement with tool/outcome absent", () => {
    const month = toMonthlyStatement(WIRE, "2026-07", {
      included: 500,
      used: 120,
    });

    expect(month.period.periodLabel).toBe("July 2026");
    expect(month.summary.totalUsd).toBeCloseTo(1.5);
    expect(month.summary.modelUsd).toBeCloseTo(1.5);
    // Unwritten subjects are absent, never invented.
    expect(month.apps.every((a) => a.tool === null && a.outcome === null)).toBe(
      true,
    );
    expect(
      month.byApp.every((r) => r.toolUsd === null && r.outcomeUsd === null),
    ).toBe(true);

    const core = month.apps.find((a) => a.id === "default");
    expect(core?.model.byModel).toHaveLength(2);
    expect(core?.model.turns).toBe(12);
    expect(core?.settings.appByok).toBe(false);

    // An app whose every line is BYOK is marked as paying with its own key.
    const uni = month.apps.find((a) => a.id === "uniswap");
    expect(uni?.settings.appByok).toBe(true);
    expect(uni?.model.billed).toBe(false);
    expect(uni?.model.byModel[0]?.note).toBe("paid by your own key");

    // Payment strip reports account funding buckets, not inference key ownership.
    expect(month.payment.allowanceAppliedUsd).toBeCloseTo(1.0);
    expect(month.payment.creditBankAppliedUsd).toBeCloseTo(0.2);
    expect(month.payment.settledVia).toBe(
      "monthly allowance + Credit Bank + your own key",
    );
    expect(month.payment.allowanceCredits).toEqual({
      included: 500,
      used: 120,
    });
  });

  it("paginates every row in the requested month and preserves funding buckets", async () => {
    const row = (index: number) => ({
      usage_event_id: `usage-${index}`,
      operation_id: `operation-${index}`,
      application: "default",
      provider: "openai",
      model: "gpt-test",
      input_tokens: 10,
      output_tokens: 5,
      inference_funding_source: "platform" as const,
      gross_charge_microusd: 10_000,
      included_applied_microusd: index < 125 ? 10_000 : 0,
      bank_debit_microusd: index < 125 ? 0 : 10_000,
      occurred_at: 1_785_542_400 + index,
    });
    fetchMock
      .mockResolvedValueOnce({
        entries: Array.from({ length: 100 }, (_, index) => row(index)),
        next_cursor: "page-2",
      })
      .mockResolvedValueOnce({
        entries: Array.from({ length: 100 }, (_, index) => row(index + 100)),
        next_cursor: "page-3",
      })
      .mockResolvedValueOnce({
        entries: Array.from({ length: 50 }, (_, index) => row(index + 200)),
        next_cursor: null,
      });

    const statement = await fetchModelStatement("2026-08");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("from=1785542400");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=page-2");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("cursor=page-3");
    expect(statement.apps[0]?.turns).toBe(250);
    expect(statement.total_credits_used).toBe(250);
    expect(statement.payment).toMatchObject([
      { method: "included", credits_used: 125 },
      { method: "credit_bank", credits_used: 125 },
    ]);
  });

  it("keeps provider and payment method on otherwise-identical model rows", () => {
    const mixed: WireModelStatement = {
      ...WIRE,
      apps: [
        {
          ...WIRE.apps[0],
          by_model: [
            {
              ...WIRE.apps[0].by_model[0],
              model: "claude-sonnet-5",
              payment_method: "null",
            },
            {
              ...WIRE.apps[0].by_model[0],
              model: "claude-sonnet-5",
              payment_method: "byok",
            },
          ],
        },
      ],
    };

    const month = toMonthlyStatement(mixed, "2026-07", {
      included: 500,
      used: 120,
    });

    expect(month.apps[0]?.model.byModel).toMatchObject([
      {
        model: "claude-sonnet-5",
        provider: "anthropic",
        paymentMethod: "null",
      },
      {
        model: "claude-sonnet-5",
        provider: "anthropic",
        paymentMethod: "byok",
        note: "paid by your own key",
      },
    ]);
  });
});
