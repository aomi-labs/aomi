import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AomiWalletKit } from "@/lib/wallet-kit";
import { ConnectButton } from "./connect-button";
import { DualWalletBar } from "./dual-wallet-bar";

const openPicker = vi.fn();

vi.mock("./wallet-picker-context", () => ({
  WalletPickerProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useWalletPicker: () => ({
    open: false,
    openPicker,
    closePicker: vi.fn(),
  }),
}));

vi.mock("./wallet-picker", () => ({
  WalletPicker: () => null,
}));

vi.mock("../../lib/wallet-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/wallet-kit")>();
  return {
    ...actual,
    useAomiWalletKit: () => adapterState.current,
  };
});

const adapterState: {
  current: Pick<
    AomiWalletKit,
    "identity" | "accounts" | "wallets" | "isReady" | "canConnect"
  > & {
    selectAccount: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    signOutAccount: ReturnType<typeof vi.fn>;
  };
} = {
  current: {
    isReady: true,
    canConnect: true,
    identity: {
      status: "connected" as "connected" | "disconnected",
      isConnected: true as boolean,
      address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      chainId: 1,
      svmAddress: undefined,
    } as AomiWalletKit["identity"],
    accounts: [
      {
        id: "mm",
        family: "evm" as const,
        address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        walletName: "MetaMask",
        chainId: 1,
        active: true as boolean,
      },
    ],
    wallets: [],
    selectAccount: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    signOutAccount: vi.fn(async () => undefined),
  },
};

afterEach(() => {
  cleanup();
  openPicker.mockClear();
  adapterState.current.isReady = true;
  adapterState.current.canConnect = true;
  adapterState.current.identity = {
    status: "connected",
    isConnected: true,
    address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    chainId: 1,
    svmAddress: undefined,
  };
  adapterState.current.accounts = [
    {
      id: "mm",
      family: "evm",
      address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      walletName: "MetaMask",
      chainId: 1,
      active: true,
    },
  ];
  adapterState.current.selectAccount.mockClear();
  adapterState.current.disconnect.mockClear();
  adapterState.current.signOutAccount.mockReset();
  adapterState.current.signOutAccount.mockResolvedValue(undefined);
});

describe("DualWalletBar account menu", () => {
  it("opens WalletPicker directly when account menu is disabled", () => {
    render(<DualWalletBar families={["evm"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("menu", { name: "Account menu" }),
    ).not.toBeInTheDocument();
  });

  it("waits for wallet connection options before opening the picker", () => {
    adapterState.current.isReady = false;
    adapterState.current.canConnect = false;
    const { rerender } = render(<DualWalletBar families={["evm"]} />);
    const chip = screen.getByRole("button", { name: "Connect wallet" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-busy", "true");
    fireEvent.click(chip);
    expect(openPicker).not.toHaveBeenCalled();

    // External wallets can connect while the additive auth provider boots.
    adapterState.current.canConnect = true;
    rerender(<DualWalletBar families={["evm"]} />);
    expect(chip).toBeEnabled();
    fireEvent.click(chip);
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("opens AccountMenu instead of WalletPicker when enabled and connected", () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          secondaryLine: "420 left · 80/500 used",
          onOpenSettings: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("420 left · 80/500 used")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(openPicker).not.toHaveBeenCalled();
    expect(
      screen.getByRole("menu", { name: "Account menu" }),
    ).toBeInTheDocument();
  });

  it("quick-switches connected wallets from the account summary", async () => {
    adapterState.current.accounts = [
      {
        id: "rabby",
        family: "evm",
        address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        walletName: "Rabby",
        chainId: 1,
        active: true,
      },
      {
        id: "metamask",
        family: "evm",
        address: "0x99C7656EC7ab88b098defB751B7401B5f6d8900",
        walletName: "MetaMask",
        chainId: 1,
        active: false,
      },
    ];

    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Quick switch wallet" }),
    );

    expect(
      screen.getByRole("group", { name: "Quick wallet switcher" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rabby is active" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use MetaMask" }));

    await waitFor(() =>
      expect(adapterState.current.selectAccount).toHaveBeenCalledWith(
        "metamask",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "Quick wallet switcher" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens the redesigned picker from the account summary", () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Quick switch wallet" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add more" }));

    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("menu", { name: "Account menu" }),
    ).not.toBeInTheDocument();
  });

  it("renders an authenticated account menu without a connected wallet", () => {
    adapterState.current.identity = {
      status: "disconnected",
      isConnected: false,
    };
    adapterState.current.accounts = [];

    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          primaryLine: "Alice",
          secondaryLine: "Aomi account",
          onManageAccount: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    const accountMenu = screen.getByRole("menu", { name: "Account menu" });
    expect(accountMenu).toBeInTheDocument();
    expect(accountMenu).toHaveTextContent("Alice");
    expect(openPicker).not.toHaveBeenCalled();
  });

  it("routes Manage account from AccountMenu to the host settings surface", () => {
    const onManageAccount = vi.fn();
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          secondaryLine: "420 left · 80/500 used",
          onManageAccount,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByText("Manage account"));
    expect(onManageAccount).toHaveBeenCalledTimes(1);
    expect(openPicker).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menu", { name: "Account menu" }),
    ).not.toBeInTheDocument();
  });

  it("shows Sign in when account menu supplies onSignIn", () => {
    const onSignIn = vi.fn();
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          secondaryLine: "Sign in for allowance",
          onSignIn,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps session actions collapsed and disconnects only the wallet", async () => {
    const onDisconnect = vi.fn(async () => undefined);
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          secondaryLine: "420 credits left",
          onDisconnect,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Session & wallet" }));
    expect(
      screen.getByText("End the session and disconnect this device"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Disconnect MetaMask/ }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Your Aomi account stays signed in.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    expect(adapterState.current.disconnect).not.toHaveBeenCalled();
    expect(adapterState.current.signOutAccount).not.toHaveBeenCalled();
  });

  it("signs out and disconnects the wallet", async () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, secondaryLine: "420 credits left" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Session & wallet" }));
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "disconnects wallets from this browser.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(adapterState.current.signOutAccount).toHaveBeenCalledTimes(1),
    );
    expect(adapterState.current.disconnect).toHaveBeenCalledWith({
      family: "all",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("disconnects the wallet after a host-provided sign-out", async () => {
    const onSignOut = vi.fn(async () => undefined);
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{
          enabled: true,
          secondaryLine: "420 credits left",
          onSignOut,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Session & wallet" }));
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(adapterState.current.disconnect).toHaveBeenCalledWith({
      family: "all",
    });
  });

  it("defaults wallet disconnect to connector teardown only", async () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, secondaryLine: "420 credits left" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Session & wallet" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Disconnect MetaMask/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(adapterState.current.disconnect).toHaveBeenCalledWith({
        family: "all",
      }),
    );
    expect(adapterState.current.signOutAccount).not.toHaveBeenCalled();
  });

  it("still disconnects the wallet when account sign-out fails", async () => {
    adapterState.current.signOutAccount.mockRejectedValueOnce(
      new Error("sign-out failed"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, secondaryLine: "420 credits left" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Session & wallet" }));
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(adapterState.current.disconnect).toHaveBeenCalledWith({
      family: "all",
    });
    // The failure is contained and the dialog stays open for an explicit retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    warn.mockRestore();
  });
});

it("keeps the account menu available without wallet picker rows", () => {
  const rows = adapterState.current.wallets;
  adapterState.current.wallets = [];
  const onManageAccount = vi.fn();
  try {
    render(<ConnectButton accountMenu={{ enabled: true, onManageAccount }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByText("Manage account"));
    expect(onManageAccount).toHaveBeenCalledOnce();
    expect(openPicker).not.toHaveBeenCalled();
  } finally {
    adapterState.current.wallets = rows;
  }
});

it("keeps one chip shape and expand icon when signed out and signed in", () => {
  adapterState.current.identity = {
    status: "disconnected",
    isConnected: false,
  } as AomiWalletKit["identity"];
  adapterState.current.accounts = [];
  const { unmount } = render(
    <DualWalletBar families={["evm"]} disconnectedLabel="Sign in" />,
  );
  const signedOut = screen.getByRole("button", { name: "Sign in" });
  const signedOutClass = signedOut.className;
  const signedOutIcon = signedOut.querySelector("svg")?.getAttribute("class");
  unmount();

  render(
    <DualWalletBar
      families={["evm"]}
      accountMenu={{ enabled: true, primaryLine: "Ada" }}
    />,
  );
  const signedIn = screen.getByRole("button", { name: "Open account menu" });
  expect(signedIn.className).toBe(signedOutClass);
  expect(signedIn.querySelector(":scope > svg")?.getAttribute("class")).toBe(
    signedOutIcon,
  );
});

it("does not offer Switch network in the account menu", () => {
  render(
    <DualWalletBar
      families={["evm"]}
      accountMenu={{ enabled: true, onOpenSettings: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
  expect(
    screen.getByRole("menu", { name: "Account menu" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Switch network")).not.toBeInTheDocument();
});

it("shows the wallet chip, not the legacy connect button, while booting", () => {
  adapterState.current.identity = {
    status: "booting",
    isConnected: false,
  } as AomiWalletKit["identity"];
  adapterState.current.accounts = [];
  render(<ConnectButton families={["evm", "solana"]} connectLabel="Sign in" />);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument();
});
