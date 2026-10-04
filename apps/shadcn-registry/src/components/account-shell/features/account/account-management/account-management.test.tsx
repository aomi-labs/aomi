import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortenAddress } from "../account-api";
import {
  visibleSignInMethods,
  type ManagedWallet,
} from "../wallet-management-model";
import { AccountManagement } from "./account-management";

const wallet = (
  address: string,
  family: "evm" | "svm",
  overrides: Partial<ManagedWallet> = {},
): ManagedWallet =>
  ({
    key: `${family}:${family === "evm" ? address.toLowerCase() : address}`,
    family,
    address,
    kind: "external",
    state: "ready",
    connected: true,
    linked: true,
    operating: false,
    connectionId: `connection:${address}`,
    linkedWalletId: `linked:${address}`,
    actions: [
      { kind: "select", walletKey: `${family}:${address}` },
      { kind: "disconnect", connectionId: `connection:${address}` },
      { kind: "unlink", linkedWalletId: `linked:${address}` },
    ],
    ...overrides,
  }) as ManagedWallet;

const privyIdentity = {
  id: "privy-1",
  provider: "privy",
  subject: "privy-user-1",
  email: "cecilia@example.com",
};

const paraIdentity = {
  id: "para-1",
  provider: "para",
  subject: "para-user-1",
  email: "para@example.com",
};

const props = (wallets: ManagedWallet[]) => ({
  user: { id: "user-1", displayName: "Aomi account" },
  wallets,
  signInMethods: [privyIdentity],
  canAddWallet: true,
  pending: null,
  onAddWallet: vi.fn(),
  onSelectWallet: vi.fn(async () => undefined),
});

const selectRow = (item: ManagedWallet) =>
  screen.getByRole("button", {
    name: `Make ${shortenAddress(item.address)} active`,
  });

const actionsFor = (item: ManagedWallet) =>
  screen.getByRole("button", {
    name: `Actions for ${item.walletName ?? item.label ?? (item.family === "evm" ? "EVM wallet" : "SVM wallet")} ${shortenAddress(item.address)}`,
  });

const chooseAction = (trigger: HTMLElement, name: string) => {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name }));
};

const walletsPanel = () =>
  screen.getByText("Wallets & access").closest("section")!;

const lineFor = (item: ManagedWallet) =>
  within(walletsPanel())
    .getByText(
      `${shortenAddress(item.address)} · ${item.family === "svm" ? "SVM" : "EVM"}`,
    )
    .closest("[data-wallet-state]") as HTMLElement;

describe("unified account wallets", () => {
  it("uses the verified email for a generated provider name and keeps a custom name", () => {
    const callbacks = props([]);
    const { rerender } = render(
      <AccountManagement
        {...callbacks}
        signInMethods={[]}
        user={{
          id: "user-1",
          displayName: "Privy user",
          email: "cecilia@example.com",
        }}
      />,
    );
    expect(screen.getByText("cecilia@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Privy user")).not.toBeInTheDocument();

    rerender(
      <AccountManagement
        {...callbacks}
        signInMethods={[]}
        user={{
          id: "user-1",
          displayName: "Para user",
          email: "cecilia@example.com",
        }}
      />,
    );
    expect(screen.getByText("cecilia@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Para user")).not.toBeInTheDocument();

    rerender(
      <AccountManagement
        {...callbacks}
        signInMethods={[]}
        user={{
          id: "user-1",
          displayName: "Cecilia",
          email: "cecilia@example.com",
        }}
      />,
    );
    expect(screen.getByText("Cecilia")).toBeInTheDocument();
    expect(screen.getByText(/cecilia@example.com · /)).toBeInTheDocument();

    rerender(
      <AccountManagement
        {...callbacks}
        signInMethods={[]}
        displayEmailHint="session@example.com"
        user={{ id: "user-1", displayName: "Privy user" }}
      />,
    );
    expect(screen.getByText("session@example.com")).toBeInTheDocument();

    rerender(
      <AccountManagement
        {...callbacks}
        signInMethods={[]}
        displayEmailHint="session@example.com"
        user={{ id: "user-1", displayName: "Cecilia" }}
      />,
    );
    expect(screen.getByText("Cecilia")).toBeInTheDocument();
    expect(screen.queryByText("session@example.com")).not.toBeInTheDocument();
  });

  it("shows no rows for sign-in methods other than Para and Privy", () => {
    const callbacks = props([]);
    render(
      <AccountManagement
        {...callbacks}
        signInMethods={visibleSignInMethods([
          { id: "email-1", provider: "email", subject: "email@example.com" },
          { id: "github-1", provider: "github", subject: "github-user" },
          { id: "google-1", provider: "google", subject: "google-user" },
        ])}
      />,
    );
    const panel = within(walletsPanel());
    expect(panel.queryByText("Email")).not.toBeInTheDocument();
    expect(panel.queryByText("Github")).not.toBeInTheDocument();
    expect(panel.queryByText("Google")).not.toBeInTheDocument();
    expect(
      panel.getByText("No wallets are connected or linked yet."),
    ).toBeInTheDocument();
  });

  it("explains active addresses and attention statuses through the help control", async () => {
    render(<AccountManagement {...props([])} />);
    fireEvent.focus(
      screen.getByRole("button", { name: "About Wallets & access" }),
    );
    const hint = await screen.findByRole("tooltip");
    expect(hint).toHaveTextContent(/one EVM and one SVM/);
    expect(hint).toHaveTextContent(/Linked wallets are saved to this account/);
    expect(hint).toHaveTextContent(/On this device means a wallet connection/);
    expect(hint).toHaveTextContent(/Connecting a wallet does not link it/);
    expect(hint).not.toHaveTextContent(/Connected:/);
    expect(hint).not.toHaveTextContent(/Linked:/);
  });

  it("counts addresses and those on this device in the header", () => {
    const live = wallet("0xLive", "evm");
    const away = wallet("AwaySvm", "svm", {
      connected: false,
      connectionId: undefined,
      state: "offline",
      reason: "disconnected",
      actions: [{ kind: "connect", walletKey: "svm:AwaySvm" }],
    });
    render(<AccountManagement {...props([live, away])} />);
    expect(
      within(walletsPanel()).getByText("2 addresses · 1 on this device"),
    ).toBeInTheDocument();
  });

  it("nests a provider login's EVM and SVM addresses under one card", () => {
    const evm = wallet("0xdc27000000000000000000000000000000000e12", "evm", {
      kind: "embedded",
      provider: "para",
      walletName: "Para Wallet",
    });
    const svm = wallet("DUcPAX000000000000000000000000000007L4U", "svm", {
      kind: "embedded",
      provider: "para",
      walletName: "Para Solana",
      operating: true,
      actions: [],
    });
    const { container } = render(
      <AccountManagement
        {...props([svm, evm])}
        signInMethods={[paraIdentity]}
      />,
    );
    const cards = container.querySelectorAll('[data-wallet-provider="para"]');
    expect(cards).toHaveLength(1);
    const card = within(cards[0] as HTMLElement);
    expect(card.getAllByText("Para")).toHaveLength(1);
    expect(
      card.getByText("para@example.com · signed in on this device"),
    ).toBeInTheDocument();
    expect(card.queryByText("Para Wallet")).not.toBeInTheDocument();
    expect(card.queryByText("Para Solana")).not.toBeInTheDocument();
    const lines = cards[0].querySelectorAll("[data-wallet-state]");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(`${shortenAddress(evm.address)} · EVM`);
    expect(lines[1]).toHaveTextContent(`${shortenAddress(svm.address)} · SVM`);
    expect(lines[1]).toHaveAttribute("data-wallet-state", "active");
    expect(within(lines[1] as HTMLElement).getByText("Active")).toHaveAttribute(
      "data-status-tone",
      "success",
    );
    expect(card.getByTitle("para wallet")).toBeInTheDocument();
    for (const badge of ["Connected", "Linked"]) {
      expect(card.queryByText(badge)).not.toBeInTheDocument();
    }
  });

  it("uses the Privy catalog mark on a Privy login card", () => {
    const evm = wallet("0xPrivyEvm", "evm", {
      kind: "embedded",
      provider: "privy",
    });
    render(<AccountManagement {...props([evm])} />);
    const privyMark = within(walletsPanel())
      .getByTitle("privy wallet")
      .querySelector("svg");
    expect(privyMark).toHaveAttribute("viewBox", "0 0 37.32 48");
  });

  it("clicking a Para SVM line activates only that SVM address", () => {
    const evm = wallet("0xParaEvm", "evm", {
      kind: "embedded",
      provider: "para",
    });
    const svm = wallet("ParaSvm", "svm", {
      kind: "embedded",
      provider: "para",
    });
    const callbacks = props([evm, svm]);
    render(<AccountManagement {...callbacks} signInMethods={[paraIdentity]} />);
    expect(within(lineFor(svm)).getByText("Use for SVM")).toBeInTheDocument();
    fireEvent.click(selectRow(svm));
    expect(callbacks.onSelectWallet).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectWallet).toHaveBeenCalledWith(svm);
    expect(
      screen.queryByRole("button", { name: "Para" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an external EVM and a Para SVM active at the same time", () => {
    const rabby = wallet("0xRabby", "evm", {
      walletName: "Rabby",
      operating: true,
      actions: [{ kind: "disconnect", connectionId: "connection:0xRabby" }],
    });
    const paraEvm = wallet("0xParaEvm", "evm", {
      kind: "embedded",
      provider: "para",
    });
    const paraSvm = wallet("ParaSvm", "svm", {
      kind: "embedded",
      provider: "para",
      operating: true,
      actions: [],
    });
    const { container } = render(
      <AccountManagement
        {...props([rabby, paraEvm, paraSvm])}
        signInMethods={[paraIdentity]}
      />,
    );
    const active = container.querySelectorAll('[data-wallet-state="active"]');
    expect(active).toHaveLength(2);
    expect(lineFor(rabby)).toHaveAttribute("data-wallet-state", "active");
    expect(lineFor(paraSvm)).toHaveAttribute("data-wallet-state", "active");
    expect(lineFor(paraEvm)).toHaveAttribute("data-wallet-state", "ready");
    expect(selectRow(paraEvm)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `Make ${shortenAddress(rabby.address)} active`,
      }),
    ).not.toBeInTheDocument();
  });

  it("selects eligible EVM and SVM rows independently without changing the other operating family", () => {
    const evm = wallet("0xEvmCandidate", "evm");
    const svm = wallet("SvmCandidate", "svm");
    const evmOperating = wallet("0xEvmOperating", "evm", {
      operating: true,
      actions: [],
    });
    const svmOperating = wallet("SvmOperating", "svm", {
      operating: true,
      actions: [],
    });
    const callbacks = props([evmOperating, evm, svmOperating, svm]);
    const { container, rerender } = render(
      <AccountManagement {...callbacks} />,
    );

    fireEvent.click(selectRow(evm));
    expect(callbacks.onSelectWallet).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectWallet).toHaveBeenLastCalledWith(evm);
    rerender(
      <AccountManagement
        {...callbacks}
        wallets={[
          { ...evmOperating, operating: false },
          { ...evm, operating: true, actions: [] },
          svmOperating,
          svm,
        ]}
      />,
    );
    const activeRows = container.querySelectorAll(
      '[data-wallet-state="active"]',
    );
    expect(activeRows).toHaveLength(2);
    expect(activeRows[0]).toHaveTextContent(shortenAddress(evm.address));
    expect(activeRows[1]).toHaveTextContent(
      shortenAddress(svmOperating.address),
    );

    fireEvent.click(selectRow(svm));
    expect(callbacks.onSelectWallet).toHaveBeenCalledTimes(2);
    expect(callbacks.onSelectWallet).toHaveBeenLastCalledWith(svm);
  });

  it("maps each wallet state to one status and one inline fix", () => {
    const offline = wallet("0xOffline", "evm", {
      connected: false,
      connectionId: undefined,
      state: "offline",
      reason: "disconnected",
      actions: [{ kind: "connect", walletKey: "evm:0xoffline" }],
    });
    const unlinked = wallet("0xUnlinked", "evm", {
      linked: false,
      linkedWalletId: undefined,
      state: "unlinked",
      actions: [{ kind: "link", connectionId: "unlinked" }],
    });
    const expired = wallet("ExpiredSvm", "svm", {
      kind: "embedded",
      provider: "privy",
      connected: false,
      state: "offline",
      reason: "signer_unavailable",
      actions: [{ kind: "reauthenticate", provider: "privy" }],
    });
    const changed = wallet("0xChanged", "evm", {
      kind: "embedded",
      provider: "privy",
      state: "mismatch",
      observedAddress: "0xOther",
      actions: [{ kind: "reauthenticate", provider: "privy" }],
    });
    const unloaded = wallet("UnloadedSvm", "svm", {
      kind: "embedded",
      provider: "para",
      connected: false,
      state: "offline",
      reason: "provider_unavailable",
      actions: [{ kind: "unlink", linkedWalletId: "linked:UnloadedSvm" }],
    });
    const checking = wallet("0xChecking", "evm", {
      state: "loading",
      actions: [],
    });
    const faulted = wallet("0xFaulted", "evm", {
      state: "offline",
      reason: "account_error",
      actions: [],
    });
    const callbacks = props([
      offline,
      unlinked,
      expired,
      changed,
      unloaded,
      checking,
      faulted,
    ]);
    const onConnectWallet = vi.fn(async () => undefined);
    const onLinkWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onConnectWallet={onConnectWallet}
        onLinkWallet={onLinkWallet}
      />,
    );

    const expectLine = (
      item: ManagedWallet,
      status: string,
      tone: string,
      action?: string,
    ) => {
      const line = within(lineFor(item));
      expect(line.getByText(status)).toHaveAttribute("data-status-tone", tone);
      expect(
        line.queryAllByRole("button", {
          name: /^(Connect|Link wallet|Sign in again|Re-verify)$/,
        }),
      ).toHaveLength(action ? 1 : 0);
      expect(
        line.getByRole("button", { name: `View full address ${item.address}` }),
      ).toBeInTheDocument();
      if (action) fireEvent.click(line.getByRole("button", { name: action }));
    };
    expectLine(offline, "Not on this device", "neutral", "Connect");
    expectLine(unlinked, "Not linked", "warning", "Link wallet");
    expectLine(expired, "Session expired", "warning", "Sign in again");
    expectLine(changed, "Address changed", "danger", "Re-verify");
    expectLine(unloaded, "Para not loaded", "neutral");
    expectLine(checking, "Checking…", "neutral");
    expectLine(faulted, "Couldn't verify", "neutral");

    expect(onConnectWallet.mock.calls).toEqual([
      [offline],
      [expired],
      [changed],
    ]);
    expect(onLinkWallet).toHaveBeenCalledWith(unlinked);
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    for (const badge of ["Connected", "Linked"]) {
      expect(screen.queryByText(badge)).not.toBeInTheDocument();
    }
  });

  it("keeps disconnect and unlink in an external wallet's menu, apart from selection", () => {
    const ready = wallet("0xReady", "evm", { walletName: "Rabby" });
    const callbacks = props([ready]);
    const onDisconnectWallet = vi.fn(async () => undefined);
    const onUnlinkWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onDisconnectWallet={onDisconnectWallet}
        onUnlinkWallet={onUnlinkWallet}
      />,
    );
    expect(within(lineFor(ready)).queryByText(/Not linked|Active/)).toBeNull();
    chooseAction(actionsFor(ready), "Disconnect");
    chooseAction(actionsFor(ready), "Unlink wallet");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onDisconnectWallet).toHaveBeenCalledWith(ready);
    expect(onUnlinkWallet).toHaveBeenCalledWith(ready);
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
  });

  it("closes the action menu with Escape without selecting or disconnecting the wallet", async () => {
    const item = wallet("0xMenu", "evm");
    const callbacks = props([item]);
    const onDisconnectWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onDisconnectWallet={onDisconnectWallet}
      />,
    );
    const trigger = actionsFor(item);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("menuitem", { name: "Disconnect" }),
    ).toBeInTheDocument();
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onDisconnectWallet).not.toHaveBeenCalled();
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
  });

  it("opens the existing wallet catalog through Add a wallet", () => {
    const callbacks = props([]);
    render(<AccountManagement {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a wallet" }));
    expect(callbacks.onAddWallet).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Add provider" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a provider login without addresses visible and removable", () => {
    const onUnlinkSignIn = vi.fn(async () => undefined);
    const callbacks = props([]);
    render(
      <AccountManagement {...callbacks} onUnlinkSignIn={onUnlinkSignIn} />,
    );
    const panel = within(walletsPanel());
    expect(panel.getByText("cecilia@example.com")).toBeInTheDocument();
    chooseAction(
      panel.getByRole("button", { name: "Actions for Privy" }),
      "Unlink Privy sign-in",
    );
    expect(onUnlinkSignIn).toHaveBeenCalledWith(privyIdentity);
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
  });

  it("puts provider disconnect, address unlink and sign-in removal on the login header", async () => {
    const evm = wallet("0xPrivy", "evm", {
      kind: "embedded",
      provider: "privy",
    });
    const svm = wallet("PrivySvm", "svm", {
      kind: "embedded",
      provider: "privy",
    });
    const callbacks = props([evm, svm]);
    const onUnlinkSignIn = vi.fn(async () => undefined);
    const onUnlinkWallet = vi.fn(async () => undefined);
    const onDisconnectWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onUnlinkSignIn={onUnlinkSignIn}
        onUnlinkWallet={onUnlinkWallet}
        onDisconnectWallet={onDisconnectWallet}
      />,
    );
    const header = () =>
      screen.getByRole("button", { name: "Actions for Privy" });
    expect(
      screen.queryByRole("button", { name: /^Actions for .* 0x/ }),
    ).not.toBeInTheDocument();
    chooseAction(header(), "Unlink SVM address");
    expect(onUnlinkWallet).toHaveBeenCalledWith(svm);
    chooseAction(header(), "Unlink Privy sign-in");
    expect(onUnlinkSignIn).toHaveBeenCalledWith(privyIdentity);
    chooseAction(header(), "Disconnect on this device");
    await waitFor(() =>
      expect(onDisconnectWallet.mock.calls).toEqual([[evm], [svm]]),
    );
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
  });

  it("disables a pending wallet selection and provider identity removal", () => {
    const item = wallet("0xPending", "evm");
    const callbacks = props([item]);
    const onUnlinkSignIn = vi.fn(async () => undefined);
    const { rerender } = render(
      <AccountManagement
        {...callbacks}
        pending={`select:${item.key}`}
        onUnlinkSignIn={onUnlinkSignIn}
        onDisconnectWallet={vi.fn(async () => undefined)}
      />,
    );
    expect(selectRow(item)).toBeDisabled();
    expect(actionsFor(item)).toBeDisabled();
    fireEvent.click(selectRow(item));
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();

    rerender(
      <AccountManagement
        {...callbacks}
        pending="unlink-identity:privy-1"
        onUnlinkSignIn={onUnlinkSignIn}
      />,
    );
    const remove = screen.getByRole("button", { name: "Actions for Privy" });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(onUnlinkSignIn).not.toHaveBeenCalled();
  });
});

describe("wallet check feedback", () => {
  afterEach(() => vi.useRealTimers());
  it("offers recovery after a slow check without making the wallet selectable", async () => {
    vi.useFakeTimers();
    const checking = wallet("0xchecking", "evm", {
      state: "loading",
      connected: false,
      operating: false,
      actions: [],
    });
    const onConnectWallet = vi.fn(async () => undefined);
    const onSelectWallet = vi.fn();
    render(
      <AccountManagement
        {...props([checking])}
        onConnectWallet={onConnectWallet}
        onSelectWallet={onSelectWallet}
      />,
    );
    expect(screen.getByText("Checking…")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText("Check taking longer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Make .* active/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onConnectWallet).toHaveBeenCalledWith(checking);
    expect(onSelectWallet).not.toHaveBeenCalled();
  });
});
