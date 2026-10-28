import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { AccountSettings } from "@/account/account-settings";
import {
  AccountOverviewFixture,
  seedAccountOverview,
} from "@/test/account-overview-fixture";
import type { WalletRow } from "@/wallet/composer/wallet-state";

const CONNECTED_EVM = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const PRIVY_SVM = "8xKnQm4kZ7wRt2YbNc5vHj3PqLsDgFxA6eU9QpS1TzWv";

const walletKit = vi.hoisted(() => ({
  activateWallet: vi.fn(async () => "connecting" as const),
  signOutAccount: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  identity: {
    address: "",
    svmAddress: undefined as string | undefined,
    sessionProvider: undefined as string | undefined,
    embeddedProvider: undefined as string | undefined,
  },
  wallets: [] as WalletRow[],
  accountUser: undefined as { id: string } | undefined,
  accountGuest: false,
}));

function readyWallets(): WalletRow[] {
  return [
    {
      key: `evm:${CONNECTED_EVM.toLowerCase()}`,
      family: "evm",
      address: CONNECTED_EVM.toLowerCase(),
      kind: "external",
      walletName: "Para",
      provider: "para",
      connectionId: "para-evm",
      linkedWalletId: "linked-evm",
      state: "ready",
      connected: true,
      linked: true,
      operating: true,
      actions: [],
    },
    {
      key: `svm:${PRIVY_SVM}`,
      family: "svm",
      address: PRIVY_SVM,
      kind: "embedded",
      walletName: "Privy",
      provider: "privy",
      connectionId: "privy-svm",
      linkedWalletId: "linked-svm",
      state: "ready",
      connected: true,
      linked: true,
      operating: true,
      actions: [],
    },
  ];
}

vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => walletKit,
}));

/** The agent wallet's reads, each answered when the test says so. */
function stubAgentReads() {
  const answers: Record<string, (response: Response) => void> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: string | URL | Request) =>
        new Promise<Response>((resolve) => {
          answers[new URL(input.toString(), "https://portal.test").pathname] =
            resolve;
        }),
    ),
  );
  return (path: string, body: unknown) =>
    act(async () => answers[path]!(Response.json(body)));
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe("AccountSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletKit.identity = {
      address: CONNECTED_EVM,
      svmAddress: PRIVY_SVM,
      sessionProvider: undefined,
      embeddedProvider: undefined,
    };
    walletKit.wallets = readyWallets();
    walletKit.accountUser = undefined;
    seedAccountOverview({
      user: { user_id: "acct-1", verified_email: "alice@example.com" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    seedAccountOverview(null);
  });

  it("shows one spinner until the agent wallets answer, and never creates one", async () => {
    walletKit.accountUser = { id: "acct-1" };
    const answer = stubAgentReads();
    await act(async () =>
      render(<AccountSettings />, { wrapper: AccountOverviewFixture }),
    );
    expect(screen.getByRole("status", { name: "Loading your account" }));
    expect(screen.queryByText("Wallets & access")).toBeNull();

    await answer("/v1/account/agent-wallets", {
      pause_all: true,
      version: 2,
      wallets: [],
    });
    expect(await screen.findByText("Wallets & access")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Loading your account" }),
    ).toBeNull();
    expect(
      screen.getByText("Hosted by Aomi · all paused, nothing signs"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("None yet. Create one with Add a wallet."),
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([input, init]) => [
          init?.method ?? "GET",
          new URL(input.toString(), "https://portal.test").pathname,
        ]),
    ).toEqual([["GET", "/v1/account/agent-wallets"]]);
  });

  it("closes account settings before signing out and drops its errors", async () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    walletKit.signOutAccount.mockImplementationOnce(async () => {
      order.push("sign-out");
      throw new Error("Unauthorized");
    });
    await act(async () =>
      render(<AccountSettings onClose={onClose} />, {
        wrapper: AccountOverviewFixture,
      }),
    );

    await click(await screen.findByRole("button", { name: "Sign out" }));

    expect(order).toEqual(["close", "sign-out"]);
    expect(walletKit.disconnect).toHaveBeenCalledWith({ family: "all" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes after deleting the account but stays open if deletion fails", async () => {
    const onClose = vi.fn();
    walletKit.deleteAccount.mockRejectedValueOnce(new Error("Delete failed"));
    await act(async () =>
      render(<AccountSettings onClose={onClose} />, {
        wrapper: AccountOverviewFixture,
      }),
    );

    await click(await screen.findByRole("button", { name: "Delete" }));
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(walletKit.deleteAccount).not.toHaveBeenCalled();

    await click(screen.getByRole("button", { name: "Delete" }));
    await click(screen.getByRole("button", { name: "Delete account" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");

    await click(screen.getByRole("button", { name: "Delete" }));
    await click(screen.getByRole("button", { name: "Delete account" }));
    expect(walletKit.deleteAccount).toHaveBeenCalledTimes(2);
    expect(walletKit.disconnect).toHaveBeenCalledWith({ family: "all" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
