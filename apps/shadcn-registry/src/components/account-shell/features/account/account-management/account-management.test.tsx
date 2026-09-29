import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const props = (wallets: ManagedWallet[]) => ({
  user: { id: "user-1", displayName: "Aomi account" },
  wallets,
  signInMethods: [privyIdentity],
  canAddWallet: true,
  addSignInOptions: [],
  pending: null,
  onAddWallet: vi.fn(),
  onAddSignIn: vi.fn(async () => undefined),
  onSelectWallet: vi.fn(async () => undefined),
});

const selectRow = (item: ManagedWallet) =>
  screen.getByRole("button", {
    name: `Make ${shortenAddress(item.address)} active`,
  });

const actionsFor = (item: ManagedWallet) => {
  const title =
    item.walletName ??
    item.label ??
    (item.provider
      ? item.provider[0].toUpperCase() + item.provider.slice(1)
      : undefined) ??
    (item.family === "evm" ? "EVM wallet" : "SVM wallet");
  return screen.getByRole("button", {
    name: `Actions for ${title} ${shortenAddress(item.address)}`,
  });
};

const chooseAction = (item: ManagedWallet, name: string) => {
  fireEvent.click(actionsFor(item));
  fireEvent.click(screen.getByRole("menuitem", { name }));
};

const walletsPanel = () =>
  screen.getByText("Wallets & access").closest("section")!;

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

  it("hides a protected email identity while retaining an independent sign-in", () => {
    const callbacks = props([]);
    render(
      <AccountManagement
        {...callbacks}
        signInMethods={visibleSignInMethods([
          { id: "email-1", provider: "email", subject: "email@example.com" },
          { id: "google-1", provider: "google", subject: "google-user" },
        ])}
      />,
    );
    const panel = within(walletsPanel());
    expect(panel.queryByText("Email")).not.toBeInTheDocument();
    expect(panel.getByText("Google")).toBeInTheDocument();
  });

  it("explains wallet states and disconnect versus unlink through the accessible help control", async () => {
    render(<AccountManagement {...props([])} />);
    fireEvent.focus(
      screen.getByRole("button", { name: "About Wallets & access" }),
    );
    const hint = await screen.findByRole("tooltip");
    expect(hint).toHaveTextContent(/Connected/);
    expect(hint).toHaveTextContent(/Linked/);
    expect(hint).toHaveTextContent(/Active/);
    expect(hint).toHaveTextContent(/disconnect/i);
    expect(hint).toHaveTextContent(/unlink/i);
  });

  it("renders wallets once with family labels and both operating states in one list", () => {
    const evm = wallet("0xdc27000000000000000000000000000000000e12", "evm", {
      provider: "privy",
      operating: true,
      actions: [],
    });
    const svm = wallet("DUcPAX000000000000000000000000000007L4U", "svm", {
      provider: "privy",
      operating: true,
      actions: [],
    });
    const { container } = render(<AccountManagement {...props([evm, svm])} />);

    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    const panel = within(walletsPanel());
    expect(
      panel.getAllByText(`${shortenAddress(evm.address)} · EVM`),
    ).toHaveLength(1);
    expect(
      panel.getAllByText(`${shortenAddress(svm.address)} · SVM`),
    ).toHaveLength(1);
    expect(panel.getByText(/ · EVM$/)).toBeInTheDocument();
    expect(panel.getByText(/ · SVM$/)).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-wallet-state="active"]'),
    ).toHaveLength(2);
    for (const heading of [
      "Providers",
      "Linked wallets",
      "Active wallets",
      "Selected wallets",
      "Sign-in methods",
    ]) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
  });

  it("presents linked Privy and Para wallets with their provider title and catalog marks", () => {
    const evm = wallet("0xdc27000000000000000000000000000000000e12", "evm", {
      kind: "embedded",
      provider: "privy",
      walletName: "Privy Smart Wallet",
      operating: true,
      actions: [],
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
        {...props([evm, svm])}
        signInMethods={[
          privyIdentity,
          {
            id: "para-1",
            provider: "para",
            subject: "para-user-1",
            email: "para@example.com",
          },
        ]}
      />,
    );
    const panel = within(walletsPanel());
    expect(panel.getAllByText("Privy")).toHaveLength(1);
    expect(panel.getAllByText("Para")).toHaveLength(1);
    expect(panel.queryByText("Privy Smart Wallet")).not.toBeInTheDocument();
    expect(panel.queryByText("Para Solana")).not.toBeInTheDocument();
    expect(panel.queryByText("cecilia@example.com")).not.toBeInTheDocument();
    expect(panel.queryByText("para@example.com")).not.toBeInTheDocument();
    expect(
      panel.getByText(`${shortenAddress(evm.address)} · EVM`),
    ).toBeInTheDocument();
    expect(
      panel.getByText(`${shortenAddress(svm.address)} · SVM`),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-wallet-state="active"]'),
    ).toHaveLength(2);
    const privyMark = panel.getByTitle("privy wallet").querySelector("svg");
    expect(privyMark).toHaveAttribute("viewBox", "0 0 37.32 48");
    expect(panel.getByTitle("para wallet")).toBeInTheDocument();
    expect(
      panel.queryByRole("button", { name: "Actions for Privy sign-in" }),
    ).not.toBeInTheDocument();
    expect(
      panel.queryByRole("button", { name: "Actions for Para sign-in" }),
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
    expect(activeRows[1]).toHaveTextContent(svmOperating.address);

    fireEvent.click(selectRow(svm));
    expect(callbacks.onSelectWallet).toHaveBeenCalledTimes(2);
    expect(callbacks.onSelectWallet).toHaveBeenLastCalledWith(svm);
  });

  it("keeps connect, link, disconnect, and unlink actions separate from row selection", () => {
    const ready = wallet("0xReady", "evm");
    const offline = wallet("0xOffline", "evm", {
      connected: false,
      state: "offline",
      actions: [{ kind: "connect", walletKey: "evm:0xoffline" }],
    });
    const unlinked = wallet("0xUnlinked", "evm", {
      linked: false,
      linkedWalletId: undefined,
      state: "unlinked",
      actions: [{ kind: "link", connectionId: "unlinked" }],
    });
    const callbacks = props([ready, offline, unlinked]);
    const onConnectWallet = vi.fn(async () => undefined);
    const onLinkWallet = vi.fn(async () => undefined);
    const onDisconnectWallet = vi.fn(async () => undefined);
    const onUnlinkWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onConnectWallet={onConnectWallet}
        onLinkWallet={onLinkWallet}
        onDisconnectWallet={onDisconnectWallet}
        onUnlinkWallet={onUnlinkWallet}
      />,
    );

    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.queryByText("Not connected on this device.")).toBeNull();
    chooseAction(offline, "Connect");
    chooseAction(unlinked, "Link");
    chooseAction(ready, "Disconnect");
    chooseAction(ready, "Unlink wallet");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onConnectWallet).toHaveBeenCalledWith(offline);
    expect(onLinkWallet).toHaveBeenCalledWith(unlinked);
    expect(onDisconnectWallet).toHaveBeenCalledWith(ready);
    expect(onUnlinkWallet).toHaveBeenCalledWith(ready);
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Make 0xOffline active" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make 0xUnlinked active" }),
    ).not.toBeInTheDocument();
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

  it("opens the existing wallet catalog through Add more", () => {
    const callbacks = props([]);
    render(
      <AccountManagement
        {...callbacks}
        addSignInOptions={[{ id: "para", label: "Para", ready: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add more" }));
    expect(callbacks.onAddWallet).toHaveBeenCalledOnce();
    expect(callbacks.onAddSignIn).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Add provider" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a provider-only identity visible and removable in the unified list", () => {
    const onUnlinkSignIn = vi.fn(async () => undefined);
    const callbacks = props([]);
    render(
      <AccountManagement {...callbacks} onUnlinkSignIn={onUnlinkSignIn} />,
    );
    const panel = within(walletsPanel());
    expect(panel.getByText("cecilia@example.com")).toBeInTheDocument();
    fireEvent.click(
      panel.getByRole("button", { name: "Actions for Privy sign-in" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Unlink Privy sign-in" }),
    );
    expect(onUnlinkSignIn).toHaveBeenCalledWith(privyIdentity);
    expect(callbacks.onSelectWallet).not.toHaveBeenCalled();
  });

  it("keeps folded provider identity removal distinct from wallet unlinking", () => {
    const item = wallet("0xPrivy", "evm", { provider: "privy" });
    const callbacks = props([item]);
    const onUnlinkSignIn = vi.fn(async () => undefined);
    const onUnlinkWallet = vi.fn(async () => undefined);
    render(
      <AccountManagement
        {...callbacks}
        onUnlinkSignIn={onUnlinkSignIn}
        onUnlinkWallet={onUnlinkWallet}
      />,
    );
    chooseAction(item, "Unlink Privy sign-in");
    expect(onUnlinkSignIn).toHaveBeenCalledWith(privyIdentity);
    expect(onUnlinkWallet).not.toHaveBeenCalled();
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
    const remove = screen.getByRole("button", {
      name: "Actions for Privy sign-in",
    });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(onUnlinkSignIn).not.toHaveBeenCalled();
  });
});
