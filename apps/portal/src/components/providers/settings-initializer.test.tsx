import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { SettingsInitializer } from "./settings-initializer";
import {
  seedAccountOverview,
  useAccountOverview,
} from "@portal/lib/account-overview";

const adapterState = vi.hoisted(() => ({
  current: { accountUser: { id: "acct-a" } } as {
    accountUser?: { id: string };
  },
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => adapterState.current,
}));
vi.mock("@portal/lib/use-settings", () => ({
  useSettings: () => undefined,
}));

function AccountUserId() {
  const account = useAccountOverview();
  return <span>{account?.user.user_id ?? "none"}</span>;
}

describe("settings initializer account boundary", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    adapterState.current = { accountUser: { id: "acct-a" } };
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("clears and reloads account data when the adapter user changes", async () => {
    seedAccountOverview({ user: { user_id: "acct-a" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ user: { user_id: "acct-b" } })),
    );

    const view = render(
      <SettingsInitializer>
        <AccountUserId />
      </SettingsInitializer>,
    );
    expect(screen.getByText("acct-a")).toBeTruthy();

    adapterState.current = { accountUser: { id: "acct-b" } };
    view.rerender(
      <SettingsInitializer>
        <AccountUserId />
      </SettingsInitializer>,
    );

    expect(await screen.findByText("acct-b")).toBeTruthy();
    expect(screen.queryByText("acct-a")).toBeNull();
  });
});
