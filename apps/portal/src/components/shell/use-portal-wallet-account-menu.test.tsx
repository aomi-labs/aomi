import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { usePortalWalletAccountMenu } from "./use-portal-wallet-account-menu";
import { seedAccountOverview } from "@portal/lib/account-overview";

const walletKitState = vi.hoisted(() => ({
  current: {
    identity: { isConnected: true, chainId: 1 },
    accountGuest: false,
    accounts: [{ id: "para", walletName: "Para", active: true }],
    accountUser: undefined as
      | { id: string; displayName?: string; email?: string }
      | undefined,
    accountError: undefined as string | undefined,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    openAccountUI: vi.fn(async () => undefined),
    signOutAccount: vi.fn(async () => undefined),
  },
}));
const runtimeState = vi.hoisted(() => ({
  current: {
    account: {
      credits: {
        get: vi.fn(async () => ({
          period_utc_month: "2026-09",
          included: {
            limit_microusd: 0,
            used_microusd: 0,
            remaining_microusd: 0,
          },
          bank: { balance_microusd: 0, outstanding_debt_microusd: 0 },
          entries: [],
          next_before_id: null,
        })),
      },
    },
  },
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => walletKitState.current,
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useAomiRuntime: () => runtimeState.current,
}));

vi.mock("@portal/lib/use-settings", () => ({
  useSettings: () => ({
    settings: { colorMode: "dark" },
    updateSetting: vi.fn(),
  }),
}));

function readMenu(onManageAccount = () => undefined) {
  let captured: ReturnType<typeof usePortalWalletAccountMenu>;
  function Probe() {
    captured = usePortalWalletAccountMenu(() => undefined, onManageAccount);
    return null;
  }
  render(<Probe />);
  return captured!;
}

describe("usePortalWalletAccountMenu account wiring", () => {
  afterEach(async () => {
    await act(async () => {
      seedAccountOverview(null);
    });
    walletKitState.current.accountUser = undefined;
    walletKitState.current.accountGuest = false;
    walletKitState.current.accountError = undefined;
    walletKitState.current.connect.mockClear();
    walletKitState.current.disconnect.mockClear();
    walletKitState.current.openAccountUI.mockClear();
    walletKitState.current.signOutAccount.mockClear();
  });

  it("does not show account chrome for a connected wallet without an account", () => {
    expect(readMenu()).toBeUndefined();
  });

  it("does not show account chrome for a temporary guest", () => {
    walletKitState.current.accountGuest = true;

    expect(readMenu()).toBeUndefined();
  });

  it("keeps exchange failure copy off the truncated chip line", () => {
    walletKitState.current.accountUser = { id: "acct-a" };
    walletKitState.current.accountError =
      "This wallet or sign-in method is already linked to another Aomi account.";

    const menu = readMenu();
    expect(menu?.secondaryLine).toBe("Loading allowance…");
    expect(menu?.noticeLine).toBe(walletKitState.current.accountError);
  });

  it("shows the account name and routes account management to Settings", () => {
    const onManageAccount = vi.fn();
    walletKitState.current.accountUser = {
      id: "acct-a",
      displayName: "Alice",
    };

    const menu = readMenu(onManageAccount);
    expect(menu?.onSignIn).toBeUndefined();
    expect(menu?.primaryLine).toBe("Alice");
    expect(menu?.secondaryLine).toBe("Loading allowance…");
    menu?.onManageAccount?.();
    expect(onManageAccount).toHaveBeenCalledTimes(1);
  });

  it("leaves session and wallet teardown to widget-lib", () => {
    walletKitState.current.accountUser = { id: "acct-a" };
    const menu = readMenu();

    // DualWalletBar owns these as distinct actions; Portal does not override
    // either boundary with a combined teardown.
    expect(menu?.onSignOut).toBeUndefined();
    expect(menu?.onDisconnect).toBeUndefined();
  });
});
