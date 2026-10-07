import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createContext } from "react";
import type { AomiWalletKit } from "./types";
import type { WalletRow } from "./composer/wallet-state";
import { ConnectButton } from "./connect-button";
import { DualWalletBar } from "./dual-wallet-bar";

const openPicker = vi.fn();

vi.mock("@/wallet/picker/wallet-picker-context", () => ({
  WalletSignInOptionsContext: createContext([]),
  WalletPickerProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useWalletPicker: () => ({
    open: false,
    openPicker,
    closePicker: vi.fn(),
  }),
}));

vi.mock("@/wallet/picker/wallet-picker", () => ({
  WalletPicker: () => null,
}));

vi.mock("@/wallet/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet/context")>();
  return {
    ...actual,
    useAomiWalletKit: () => adapterState.current,
  };
});

const adapterState: {
  current: Pick<
    AomiWalletKit,
    | "identity"
    | "accounts"
    | "wallets"
    | "isReady"
    | "canConnect"
    | "accountStatus"
    | "accountUser"
    | "unlinkedWallet"
  > & {
    activateWallet: ReturnType<typeof vi.fn>;
    openAddWallet: ReturnType<typeof vi.fn>;
    openVerify: ReturnType<typeof vi.fn>;
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
    activateWallet: vi.fn(async () => "active"),
    openAddWallet: vi.fn(),
    openVerify: vi.fn(),
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
  adapterState.current.wallets = [];
  adapterState.current.accountStatus = undefined;
  adapterState.current.accountUser = undefined;
  adapterState.current.unlinkedWallet = undefined;
  adapterState.current.activateWallet.mockClear();
  adapterState.current.openAddWallet.mockClear();
  adapterState.current.openVerify.mockClear();
  window.localStorage.clear();
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
    const chip = screen.getByRole("button", { name: "Loading account" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-busy", "true");
    fireEvent.click(chip);
    expect(openPicker).not.toHaveBeenCalled();

    // External wallets can connect while the additive auth provider boots.
    adapterState.current.canConnect = true;
    rerender(<DualWalletBar families={["evm"]} />);
    expect(chip).toBeEnabled();
    expect(chip).toHaveAccessibleName("Connect wallet");
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

  it("switches a usable address in place and keeps the menu open", async () => {
    adapterState.current.wallets = [
      walletRow("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "Rabby", {
        operating: true,
      }),
      walletRow("0x99C7656EC7ab88b098defB751B7401B5f6d8900", "MetaMask"),
    ];

    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(
      screen.getByRole("button", { name: "EVM signs with Rabby" }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Use Rabby 0x71C7…976F" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Use MetaMask 0x99C7…8900" }),
    );

    await waitFor(() =>
      expect(adapterState.current.activateWallet).toHaveBeenCalledWith(
        "evm:0x99c7656ec7ab88b098defb751b7401b5f6d8900",
      ),
    );
    expect(
      screen.getByRole("menu", { name: "Account menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "EVM wallets" }),
    ).toBeInTheDocument();
  });

  it("offers Verify for a connected address that is not in the account", () => {
    adapterState.current.unlinkedWallet = walletRow(
      "0x77c1000000000000000000000000000000000a20e",
      "Rabby",
      { state: "unlinked", linked: false, linkedWalletId: undefined },
    );
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );
    expect(screen.getByText("Verify")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByText("New address in Rabby")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(adapterState.current.openVerify).toHaveBeenCalledTimes(1);
  });

  it("closes the account menu on Escape", () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("menu", { name: "Account menu" }),
    ).not.toBeInTheDocument();
  });

  it("opens the add sheet from the account summary", () => {
    render(
      <DualWalletBar
        families={["evm"]}
        accountMenu={{ enabled: true, primaryLine: "Aron" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a wallet" }));

    expect(adapterState.current.openAddWallet).toHaveBeenCalledTimes(1);
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

  it("closes the dialog before signing out", async () => {
    let finish: () => void = () => undefined;
    adapterState.current.signOutAccount.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
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

    expect(adapterState.current.signOutAccount).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("menu", { name: "Account menu" }),
    ).not.toBeInTheDocument();
    finish();
  });

  it("still disconnects the wallet when account sign-out fails", async () => {
    adapterState.current.signOutAccount.mockRejectedValueOnce(
      new Error("sign-out failed"),
    );
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

    await waitFor(() =>
      expect(adapterState.current.disconnect).toHaveBeenCalledWith({
        family: "all",
      }),
    );
    // Errors from the session being ended are dropped, not shown.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

it("shows a skeleton chip, never Sign in, while the session is unknown", () => {
  adapterState.current.identity = {
    status: "booting",
    isConnected: false,
  } as AomiWalletKit["identity"];
  adapterState.current.accounts = [];
  adapterState.current.accountStatus = "loading";
  render(<ConnectButton families={["evm", "solana"]} connectLabel="Sign in" />);
  expect(
    screen.getByRole("button", { name: "Loading account" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
  expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument();
});

it("shows the saved account at once and saves the confirmed one", () => {
  window.localStorage.setItem(
    "aomi:account-chip:default",
    JSON.stringify({ accountId: "user-1", name: "Ada", wallets: [] }),
  );
  adapterState.current.accountStatus = "loading";
  const { rerender } = render(
    <DualWalletBar families={["evm"]} disconnectedLabel="Sign in" />,
  );
  expect(screen.getByText("Ada")).toBeInTheDocument();
  expect(screen.queryByText("Sign in")).not.toBeInTheDocument();

  adapterState.current.accountStatus = "ready";
  adapterState.current.accountUser = { id: "user-2" };
  adapterState.current.wallets = [
    walletRow("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "Rabby", {
      operating: true,
    }),
  ];
  rerender(
    <DualWalletBar
      families={["evm"]}
      accountMenu={{ enabled: true, primaryLine: "Grace" }}
    />,
  );
  expect(
    JSON.parse(window.localStorage.getItem("aomi:account-chip:default")!),
  ).toEqual({
    accountId: "user-2",
    name: "Grace",
    wallets: [
      {
        family: "evm",
        address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        brand: "Rabby",
      },
    ],
  });
});

function walletRow(
  address: string,
  walletName: string,
  overrides: Partial<WalletRow> = {},
): WalletRow {
  return {
    key: `evm:${address.toLowerCase()}`,
    family: "evm",
    address,
    kind: "external",
    walletName,
    brand: walletName,
    state: "ready",
    connected: true,
    linked: true,
    operating: false,
    active: Boolean(overrides.operating),
    linkedWalletId: `linked:${address}`,
    connectionId: `connection:${address}`,
    actions: overrides.operating
      ? []
      : [
          {
            kind: "select",
            walletKey: `evm:${address.toLowerCase()}`,
          },
        ],
    ...overrides,
  } as WalletRow;
}
