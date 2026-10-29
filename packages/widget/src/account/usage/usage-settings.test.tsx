import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/account/usage/credits/credit-balance-panel", () => ({
  CreditBalancePanel: () => <div>Credit balance</div>,
}));

const account = vi.hoisted(() => ({ id: "" }));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({ accountUser: { id: account.id } }),
}));
let accountSequence = 0;

import { UsageSettings } from "@/account/usage/usage-settings";

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
  included: {
    limit_microusd: 5_000_000,
    used_microusd: 800_000,
    remaining_microusd: 4_200_000,
  },
  balance_microusd: 0,
  reserved_microusd: 0,
  available_microusd: 0,
  debt_microusd: 0,
  entries: [],
  next_before_id: null,
};

describe("usage settings wiring", () => {
  beforeEach(() => {
    account.id = `usage-test-${++accountSequence}`;
  });
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
        if (url.pathname === "/v1/account/credits/ledger")
          return Response.json({ entries: [], next_before_id: null });
        if (url.pathname === "/v1/account/credits") {
          return Response.json(CREDITS);
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });
    await screen.findByText(/of 500 left · 80 used/);

    const statementCall = calls.find((call) =>
      call.startsWith("/v1/account/statement?"),
    );
    expect(statementCall).toBeTruthy();
    const statementQuery = new URL(statementCall!, "https://portal.test");
    expect(statementQuery.searchParams.get("limit")).toBe("100");
    expect(statementQuery.searchParams.get("from")).toBeTruthy();
    expect(statementQuery.searchParams.get("to")).toBeTruthy();
    expect(calls).toContain("/v1/account/credits");
    expect(
      calls.filter((call) => call.startsWith("/v1/account/credits/ledger?")),
    ).toHaveLength(0);
    expect(screen.getAllByText("$0.80").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("No charges").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/1 turn/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/of 500 left · 80 used/)).toBeTruthy();
    expect(screen.getByText("Credit balance")).toBeTruthy();
    const settlement = screen.getByText(/Paid via monthly allowance/);
    expect(settlement.textContent).toContain(
      "Compute fully covered by your allowance ($0.80 applied).",
    );
    expect(settlement.textContent).not.toContain("On-chain fees");
    // Explanations live behind each header's (?), not as sentences.
    expect(screen.getByText("100% compute · 0% on-chain")).toBeTruthy();
    expect(screen.queryByText(/Compute subtotal/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "About Spend breakdown" }),
    ).toBeTruthy();
  });

  it("composes allowance from Credit balance instead of the profile response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/v1/account/statement") {
          return Response.json({ entries: [], next_cursor: null });
        }
        if (url.pathname === "/v1/account/credits/ledger")
          return Response.json({ entries: [], next_before_id: null });
        if (url.pathname === "/v1/account/credits") {
          return Response.json({
            ...CREDITS,
            included: {
              limit_microusd: 50_000_000,
              used_microusd: 12_500_000,
              remaining_microusd: 37_500_000,
            },
          });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    await act(async () => {
      render(<UsageSettings />);
    });

    expect(await screen.findByText(/of 5,000 left · 1,250 used/)).toBeTruthy();
    expect(screen.getByText("No usage this month yet.")).toBeTruthy();
  });

  it("turns account auth failures into an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/api/auth/sign-in/anonymous") {
          return Response.json({ code: "session_exists" }, { status: 409 });
        }
        if (url.pathname === "/v1/account/statement") {
          return Response.json(
            { error: "widget_auth_failed" },
            { status: 401 },
          );
        }
        if (url.pathname === "/v1/account/credits/ledger")
          return Response.json({ entries: [], next_before_id: null });
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

  it("keeps spend and Credit balance visible when allowance loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), "https://portal.test");
        if (url.pathname === "/v1/account/statement") {
          return Response.json(STATEMENT);
        }
        if (url.pathname === "/v1/account/credits/ledger")
          return Response.json({ entries: [], next_before_id: null });
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
    expect(screen.getByText("Credit balance")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
