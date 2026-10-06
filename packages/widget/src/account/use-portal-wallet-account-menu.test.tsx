import { useCallback, useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePortalWalletAccountMenu } from "./use-portal-wallet-account-menu";
import type { WalletAccountMenuOptions } from "@/account/account-menu-types";

const state = vi.hoisted(() => ({
  credits: {
    isPending: false,
    fetchStatus: "idle",
    data: {
      included: { used_microusd: 2_000_000, limit_microusd: 10_000_000 },
    },
  },
  accountUser: { id: "account-a", displayName: "Alice" },
  updateSetting: vi.fn(),
  published: vi.fn(),
}));

vi.mock("./use-account-credits", () => ({
  useAccountCredits: () => state.credits,
}));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    accountUser: state.accountUser,
    accountGuest: false,
    accounts: [],
    identity: {},
  }),
}));
vi.mock("./use-settings", () => ({
  useSettings: () => ({
    settings: { colorMode: "dark" },
    updateSetting: state.updateSetting,
  }),
}));
vi.mock("./transport", () => ({
  useShellTransport: () => ({ themeRoot: null }),
}));

function MenuBridge({
  publish,
}: {
  publish: (menu: WalletAccountMenuOptions | undefined) => void;
}) {
  const openSettings = useCallback(() => undefined, []);
  const menu = usePortalWalletAccountMenu(openSettings);
  useEffect(() => {
    state.published(menu);
    publish(menu);
  }, [menu, publish]);
  return null;
}

function Shell() {
  const [menu, setMenu] = useState<WalletAccountMenuOptions>();
  const [revision, setRevision] = useState(0);
  return (
    <>
      <MenuBridge publish={setMenu} />
      <span data-testid="credits">{menu?.secondaryLine}</span>
      <span data-testid="loading">{String(menu?.secondaryLoading)}</span>
      <button onClick={() => setRevision(revision + 1)}>Rerender shell</button>
    </>
  );
}

describe("account menu publication", () => {
  beforeEach(() => {
    state.published.mockClear();
    state.credits.isPending = false;
    state.credits.fetchStatus = "idle";
    state.credits.data.included.used_microusd = 2_000_000;
  });

  it("settles signed-account parent publication and updates only changed credit display", () => {
    render(<Shell />);
    expect(state.published).toHaveBeenCalledTimes(1);
    const initialLine = screen.getByTestId("credits").textContent;
    fireEvent.click(screen.getByRole("button"));
    expect(state.published).toHaveBeenCalledTimes(1);

    state.credits.data = {
      included: { used_microusd: 2_000_000, limit_microusd: 10_000_000 },
    };
    fireEvent.click(screen.getByRole("button"));
    expect(state.published).toHaveBeenCalledTimes(1);

    state.credits.data.included.used_microusd = 3_000_000;
    fireEvent.click(screen.getByRole("button"));
    expect(state.published).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("credits").textContent).not.toBe(initialLine);
  });

  it("settles loading publication then publishes the resolved credits once", () => {
    state.credits.isPending = true;
    state.credits.fetchStatus = "fetching";
    render(<Shell />);
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    state.credits.isPending = false;
    state.credits.fetchStatus = "idle";
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(state.published).toHaveBeenCalledTimes(2);
  });
});
