import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountScopedFetch } from "../../../../shadcn-registry/src/components/account-shell/lib/settings-api";

import {
  fetchMonthlyStatement,
  monthRange,
  recentMonthKeys,
} from "../../../../shadcn-registry/src/components/account-shell/features/usage/statement-api";

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/lib/settings-api",
  () => ({ accountScopedFetch: vi.fn() }),
);

const fetchMock = vi.mocked(accountScopedFetch);

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

  it("maps current usage charges directly onto the shared statement model", async () => {
    fetchMock
      .mockResolvedValueOnce({
        entries: [
          {
            usage_event_id: "usage-1",
            execution_id: "operation-1",
            application_id: null,
            provider: "anthropic",
            model: "claude-sonnet-5",
            input_tokens: 3600,
            output_tokens: 700,
            funding: { kind: "platform", application_id: null },
            gross: 1_000_000,
            included: 1_000_000,
            credits: 0,
            details: {},
            occurred_at: 1,
          },
          {
            usage_event_id: "usage-2",
            execution_id: "operation-2",
            application_id: null,
            provider: "anthropic",
            model: "claude-haiku-4-5",
            input_tokens: 400,
            output_tokens: 200,
            funding: { kind: "platform", application_id: null },
            gross: 200_000,
            included: 0,
            credits: 200_000,
            details: {},
            occurred_at: 2,
          },
          {
            usage_event_id: "usage-3",
            execution_id: "operation-3",
            application_id: 7,
            provider: "anthropic",
            model: "claude-sonnet-5",
            input_tokens: 800,
            output_tokens: 150,
            funding: { kind: "application_key", application_id: 7 },
            gross: 300_000,
            included: 0,
            credits: 0,
            details: {},
            occurred_at: 3,
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce([
        { name: "uniswap", application_id: 7, is_public: true },
      ]);

    const month = await fetchMonthlyStatement("2026-07");

    expect(month.period.periodLabel).toBe("July 2026");
    expect(month.summary.totalUsd).toBeCloseTo(1.5);
    expect(month.summary.modelUsd).toBeCloseTo(1.5);
    expect(month.summary.computeUsd).toBeCloseTo(1.5);
    expect(month.summary.onchainUsd).toBe(0);
    // Unwritten subjects are absent, never invented.
    expect(month.apps.every((a) => a.tool === null && a.outcome === null)).toBe(
      true,
    );
    expect(
      month.byApp.every((r) => r.toolUsd === null && r.outcomeUsd === null),
    ).toBe(true);

    const core = month.apps.find((a) => a.id === "default");
    expect(core?.model.byModel).toHaveLength(2);
    expect(core?.model.turns).toBe(2);
    expect(core?.settings.appByok).toBe(false);

    // An app whose every line is BYOK is marked as paying with its own key.
    const uni = month.apps.find((a) => a.id === "uniswap");
    expect(uni?.settings.appByok).toBe(true);
    expect(uni?.model.billed).toBe(false);
    expect(uni?.model.byModel[0]?.note).toBe("paid by your own key");

    // Payment strip reports account funding buckets, not inference key ownership.
    expect(month.payment.allowanceAppliedUsd).toBeCloseTo(1.0);
    expect(month.payment.creditBankAppliedUsd).toBeCloseTo(0.2);
    expect(month.payment.settledVia).toBe("monthly allowance + Credit Bank");
    expect(month.payment.allowanceCredits).toEqual({ included: 0, used: 0 });
  });

  it("paginates every row in the requested month and preserves funding buckets", async () => {
    const row = (index: number) => ({
      usage_event_id: `usage-${index}`,
      execution_id: `operation-${index}`,
      application_id: 7,
      provider: "openai",
      model: "gpt-test",
      input_tokens: 10,
      output_tokens: 5,
      funding: { kind: "platform", application_id: 7 },
      gross: 10_000,
      included: index < 125 ? 10_000 : 0,
      credits: index < 125 ? 0 : 10_000,
      details: {},
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
      })
      .mockResolvedValueOnce([
        { name: "uniswap", application_id: 7, is_public: true },
      ]);

    const statement = await fetchMonthlyStatement("2026-08");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("from=1785542400");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=page-2");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("cursor=page-3");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/account/apps");
    expect(statement.apps[0]?.name).toBe("uniswap");
    expect(statement.apps[0]?.model.turns).toBe(250);
    expect(statement.summary.totalUsd).toBe(2.5);
    expect(statement.payment).toMatchObject({
      allowanceAppliedUsd: 1.25,
      creditBankAppliedUsd: 1.25,
    });
  });

  it("keeps current funding kinds on otherwise-identical model rows", async () => {
    const row = (funding: "platform" | "user_key") => ({
      usage_event_id: `usage-${funding}`,
      execution_id: `operation-${funding}`,
      application_id: null,
      provider: "anthropic",
      model: "claude-sonnet-5",
      input_tokens: 10,
      output_tokens: 5,
      funding: { kind: funding, application_id: null },
      gross: 10_000,
      included: funding === "platform" ? 10_000 : 0,
      credits: 0,
      details: {},
      occurred_at: 1,
    });
    fetchMock.mockResolvedValueOnce({
      entries: [row("platform"), row("user_key")],
      next_cursor: null,
    });

    const month = await fetchMonthlyStatement("2026-07");

    expect(month.apps[0]?.model.byModel).toMatchObject([
      {
        model: "claude-sonnet-5",
        provider: "anthropic",
        paymentMethod: "platform",
      },
      {
        model: "claude-sonnet-5",
        provider: "anthropic",
        paymentMethod: "user_key",
        note: "paid by your own key",
      },
    ]);
  });
});
