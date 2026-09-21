import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import {
  creditAllowanceFromPosition,
  formatAllowanceSummary,
  scopeAccountOverviewToUser,
  seedAccountOverview,
  useAccountOverview,
} from "../../../shadcn-registry/src/components/account-shell/lib/account-overview";

function AccountUserId() {
  const account = useAccountOverview();
  return <span>{account?.user.user_id ?? "none"}</span>;
}

describe("account overview store", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("drops a snapshot from another authenticated account", async () => {
    seedAccountOverview({ user: { user_id: "acct-a" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ user: { user_id: "acct-b" } })),
    );

    render(<AccountUserId />);
    expect(screen.getByText("acct-a")).toBeTruthy();

    await act(async () => {
      scopeAccountOverviewToUser("acct-b");
    });

    expect(await screen.findByText("acct-b")).toBeTruthy();
  });

  it("ignores an old account request after the store is reseeded", async () => {
    let finishOldRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Promise<Response>((resolve) => {
            finishOldRequest = resolve;
          }),
      ),
    );

    render(<AccountUserId />);
    expect(screen.getByText("none")).toBeTruthy();

    await act(async () => {
      seedAccountOverview({ user: { user_id: "acct-b" } });
      finishOldRequest?.(Response.json({ user: { user_id: "acct-a" } }));
    });

    expect(screen.getByText("acct-b")).toBeTruthy();
    expect(screen.queryByText("acct-a")).toBeNull();
  });
});

describe("formatAllowanceSummary", () => {
  it("formats the sidebar allowance copy", () => {
    expect(formatAllowanceSummary(80, 500)).toBe("420 left · 80/500 used");
  });
});

describe("creditAllowanceFromPosition", () => {
  it("derives the allowance from the validated SDK position", () => {
    expect(
      creditAllowanceFromPosition({
        period_utc_month: "2026-09-01",
        included: {
          used_microusd: 120_000,
          limit_microusd: 1_000_000,
          remaining_microusd: 880_000,
        },
        bank: { balance_microusd: 0, outstanding_debt_microusd: 0 },
        entries: [],
        next_before_id: null,
      }),
    ).toEqual({ used: 12, included: 100 });
  });

  it("returns no allowance before the SDK position is available", () => {
    expect(creditAllowanceFromPosition(null)).toBe(null);
  });

  it("returns no allowance for a partial runtime position", () => {
    expect(
      creditAllowanceFromPosition({
        period_utc_month: "2026-09-01",
        bank: { balance_microusd: 0, outstanding_debt_microusd: 0 },
        entries: [],
        next_before_id: null,
      }),
    ).toBe(null);
  });
});
