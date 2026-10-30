import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ id: "" }));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({ accountUser: { id: account.id }, identity: {} }),
}));
let accountSequence = 0;

import { BillingSettings } from "@/account/usage/billing-settings";

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

function serve(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString(), "https://portal.test");
      calls.push(url.pathname + url.search);
      const override = overrides[url.pathname];
      if (override) return override();
      if (url.pathname === "/v1/account/statement")
        return Response.json(STATEMENT);
      if (url.pathname === "/v1/account/credits/ledger")
        return Response.json({ entries: [], next_before_id: null });
      if (url.pathname === "/v1/account/credits") return Response.json(CREDITS);
      return new Response("unexpected", { status: 500 });
    }),
  );
  return calls;
}

describe("billing settings", () => {
  beforeEach(() => {
    account.id = `billing-test-${++accountSequence}`;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the allowance and added balance apart, in dollars", async () => {
    const calls = serve();
    await act(async () => {
      render(<BillingSettings />);
    });

    expect(await screen.findByText(/of \$5\.00 left/)).toBeTruthy();
    expect(screen.getByText("$4.20")).toBeTruthy();
    expect(screen.getByText("Added balance")).toBeTruthy();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("img", { name: /84% of monthly allowance left/ }),
    ).toBeTruthy();
    expect(await screen.findByText(/so far/)).toBeTruthy();
    expect(screen.getByText(/No payments yet/)).toBeTruthy();
    expect(screen.queryByText(/credits/i)).toBeNull();

    const statementCall = calls.find((call) =>
      call.startsWith("/v1/account/statement?"),
    );
    const query = new URL(statementCall!, "https://portal.test").searchParams;
    expect(query.get("limit")).toBe("100");
    expect(query.get("from")).toBeTruthy();
    expect(query.get("to")).toBeTruthy();
  });

  it("keeps the statement under Usage", async () => {
    serve();
    await act(async () => {
      render(<BillingSettings />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));

    expect(await screen.findByText("Spend breakdown")).toBeTruthy();
    expect(screen.getAllByText("$0.80").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("100% compute · 0% on-chain")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "About Spend breakdown" }),
    ).toBeTruthy();
  });

  it("turns account auth failures into an actionable message", async () => {
    serve({
      "/api/auth/guest": () =>
        Response.json({ code: "session_exists" }, { status: 409 }),
      "/v1/account/statement": () =>
        Response.json({ error: "widget_auth_failed" }, { status: 401 }),
    });
    await act(async () => {
      render(<BillingSettings />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));

    expect(
      await screen.findByText(
        "Couldn’t authenticate your account. Sign in again and retry.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/widget_auth_failed/)).toBeNull();
  });

  it("keeps this month's spend when the balance fails to load", async () => {
    serve({
      "/v1/account/credits": () =>
        new Response("credits unavailable", { status: 503 }),
    });
    await act(async () => {
      render(<BillingSettings />);
    });

    expect(await screen.findByText(/Couldn’t load your balance/)).toBeTruthy();
    expect(await screen.findByText(/so far/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
