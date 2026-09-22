import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../shadcn-registry/src/components/account-shell/features/usage/credit-bank",
  () => ({
    CreditBank: () => <div>Credit Bank</div>,
  }),
);

import { UsageSettings } from "../../../../shadcn-registry/src/components/account-shell/features/usage/usage-settings";

const STATEMENT = {
  entries: [
    {
      usage_event_id: "usage-1",
      execution_id: "operation-1",
      application_id: null,
      provider: "anthropic",
      model: "claude-sonnet-5",
      input_tokens: 2_000,
      output_tokens: 400,
      funding: { kind: "platform", application_id: null },
      gross: 800_000,
      included: 800_000,
      credits: 0,
      details: {},
      occurred_at: Math.floor(Date.now() / 1_000),
    },
  ],
  next_cursor: null,
};

const CREDITS = {
  period_utc_month: "2026-09-01",
  included_limit: 5_000_000,
  included_used: 800_000,
  included_remaining: 4_200_000,
  balance: 0,
  outstanding_debt: 0,
  records: [],
  next_before_id: null,
};

describe("usage settings wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads API-owned usage and renders subjects honestly", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        calls.push(url.pathname + url.search);
        if (url.pathname === "/v1/account/statement") {
          return Response.json(STATEMENT);
        }
        if (url.pathname === "/v1/account/credits") {
          return Response.json(CREDITS);
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });

    const statementCall = calls.find((call) =>
      call.startsWith("/v1/account/statement?"),
    );
    expect(statementCall).toBeTruthy();
    const statementQuery = new URL(statementCall!, "https://portal.test");
    expect(statementQuery.searchParams.get("limit")).toBe("100");
    expect(statementQuery.searchParams.get("from")).toBeTruthy();
    expect(statementQuery.searchParams.get("to")).toBeTruthy();
    expect(calls).toContain("/v1/account/credits?limit=1");
    expect(screen.getAllByText("$0.80").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/1 turn/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/80.*500.*used/)).toBeTruthy();
    expect(screen.getByText("Credit Bank")).toBeTruthy();
  });

  it("composes allowance from Credit Bank instead of the profile response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/v1/account/statement") {
          return Response.json({ entries: [], next_cursor: null });
        }
        if (url.pathname === "/v1/account/credits") {
          return Response.json({
            ...CREDITS,
            included_limit: 50_000_000,
            included_used: 12_500_000,
            included_remaining: 37_500_000,
          });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });

    expect(screen.getByText(/1,250.*5,000.*used/)).toBeTruthy();
    expect(screen.getByText("No usage this month yet.")).toBeTruthy();
  });

  it("turns account auth failures into an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/v1/account/statement") {
          return Response.json(
            { error: "widget_auth_failed" },
            { status: 401 },
          );
        }
        if (url.pathname === "/v1/account/credits") {
          return Response.json(CREDITS);
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });

    expect(
      await screen.findByText(
        "Couldn’t authenticate your account. Sign in again and retry.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/widget_auth_failed/)).toBeNull();
  });

  it("keeps spend and Credit Bank visible when allowance loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/v1/account/statement") {
          return Response.json(STATEMENT);
        }
        if (url.pathname === "/v1/account/credits") {
          return new Response("credits unavailable", { status: 503 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });

    expect(await screen.findByText("Spend breakdown")).toBeTruthy();
    expect(screen.getAllByText("$0.80").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Credit Bank")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
