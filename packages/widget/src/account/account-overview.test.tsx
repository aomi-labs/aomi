import { afterEach, describe, expect, it, vi } from "vitest";
import { focusManager } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  DisplayCacheProvider,
  useAomiDisplayCache,
  type DisplayCache,
  type RuntimeAccount,
} from "../../../react/src/query/display-cache";
import { act, render, screen } from "@testing-library/react";

import {
  creditAllowanceFromPosition,
  formatAllowanceSummary,
  useAccountOverview,
  useAccountOverviewStore,
} from "@/account/account-overview";

let cache!: DisplayCache;
let store!: ReturnType<typeof useAccountOverviewStore>;
function AccountUserId() {
  const account = useAccountOverview();
  const runtimeCache = useAomiDisplayCache();
  const overview = useAccountOverviewStore();
  useEffect(() => {
    if (runtimeCache) cache = runtimeCache;
    store = overview;
  }, [runtimeCache, overview]);
  return <span>{account?.user.user_id ?? "none"}</span>;
}
const frame = (account: RuntimeAccount | null | undefined) => (
  <DisplayCacheProvider
    backendUrl="https://account.example"
    account={account}
    persistence="none"
  >
    <AccountUserId />
  </DisplayCacheProvider>
);
const user = (id: string): RuntimeAccount => ({ kind: "user", id });
const refocus = () =>
  act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });

describe("account overview", () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.unstubAllGlobals();
  });

  it("refreshes a stale profile on focus and leaves a fresh one alone", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ user: { user_id: "acct-focus" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(frame(user("acct-focus")));
    await screen.findByText("acct-focus");
    await refocus();
    expect(fetcher).toHaveBeenCalledOnce();
    act(() => {
      cache.client.setQueryData(
        cache.key("profile"),
        { user: { user_id: "acct-focus" } },
        { updatedAt: Date.now() - 5 * 60_000 - 1 },
      );
    });
    await refocus();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, { kind: "guest", id: "g" } as const])(
    "does not read a profile for %j, then reads it once a user signs in",
    async (account) => {
      const fetcher = vi.fn(async () =>
        Response.json({ user: { user_id: "acct-confirmed" } }),
      );
      vi.stubGlobal("fetch", fetcher);
      const view = render(frame(account));
      await refocus();
      expect(fetcher).not.toHaveBeenCalled();
      expect(screen.getByText("none")).toBeTruthy();
      view.rerender(frame(user("acct-confirmed")));
      await screen.findByText("acct-confirmed");
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("refuses a profile that belongs to another account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ user: { user_id: "acct-b" } })),
    );
    render(frame(user("acct-a")));
    await act(async () => {
      await store.loadOnce();
    });
    expect(screen.getByText("none")).toBeTruthy();
    act(() => store.seedAccountOverview({ user: { user_id: "acct-b" } }));
    expect(screen.getByText("none")).toBeTruthy();
  });

  it("updates installed apps only for the account the profile belongs to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(frame(user("acct-a")));
    act(() =>
      store.seedAccountOverview({ user: { user_id: "acct-a", apps: [] } }),
    );
    act(() => store.updateAccountApps("acct-b", ["other"]));
    act(() => store.updateAccountApps("acct-a", ["uniswap"], [7]));
    expect(cache.client.getQueryData(cache.key("profile"))).toEqual({
      user: { user_id: "acct-a", apps: ["uniswap"], application_ids: [7] },
    });
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
