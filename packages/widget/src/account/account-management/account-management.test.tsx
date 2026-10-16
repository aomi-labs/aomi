import { renderToStaticMarkup } from "react-dom/server";
import { AccountAvatar } from "../account-avatar";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shortAddress, type AomiAccountWallet } from "@aomi-labs/client";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { AccountManagement } from "./account-management";

const disconnect = [{ kind: "disconnect", connectionId: "c" }] as const;

const row = (address: string, overrides: Partial<WalletRow> = {}): WalletRow =>
  ({
    key: `evm:${address.toLowerCase()}`,
    family: "evm",
    address,
    kind: "external",
    state: "ready",
    linkedWalletId: `linked:${address}`,
    linked: true,
    connected: true,
    operating: false,
    active: false,
    brand: "Rabby",
    pendingStep: null,
    actions: [...disconnect],
    ...overrides,
  }) as WalletRow;

const main = row("0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0", {
  label: "Main",
  active: true,
});
const trading = row("0x12a4000000000000000000000000000000009b3f", {
  label: "Trading",
  connected: false,
  pendingStep: "switch",
  actions: [],
});
const metamask = row("0x4f02000000000000000000000000000000077de0", {
  brand: "MetaMask",
  connected: false,
  pendingStep: "connect",
  actions: [],
});
const privyEvm = row("0x13af000000000000000000000000000000005cf7", {
  kind: "embedded",
  provider: "privy",
  brand: "Privy",
  actions: [],
});
const privySvm = row("Dmf3fB111111111111111111111111111111djxu", {
  key: "svm:Dmf3fB111111111111111111111111111111djxu",
  family: "svm",
  kind: "embedded",
  provider: "privy",
  brand: "Privy",
  active: true,
  actions: [],
});
const privy = {
  id: "privy-1",
  provider: "privy",
  subject: "privy-user",
  email: "aron@megyeri.eu",
};

const renderSettings = (
  rows: WalletRow[],
  extra: Partial<Parameters<typeof AccountManagement>[0]> = {},
) =>
  render(
    <AccountManagement
      user={{ id: "user-1", displayName: "Aron" }}
      rows={rows}
      signInMethods={[privy]}
      pending={null}
      onActivate={vi.fn()}
      onAddWallet={vi.fn()}
      {...extra}
    />,
  );

const rowFor = (item: WalletRow) =>
  document.querySelector(`[data-wallet-row="${item.key}"]`) as HTMLElement;

const openMenu = (item: WalletRow, title: string) =>
  fireEvent.click(
    within(rowFor(item)).getByRole("button", {
      name: `Actions for ${title} ${shortAddress(item.address)}`,
    }),
  );

describe("Wallets & access", () => {
  it("uses the canonical account avatar in Profile while preserving wallet brands", () => {
    const { container } = renderSettings([main]);
    const expected = document.createElement("div");
    expected.innerHTML = renderToStaticMarkup(
      <AccountAvatar seed="user-1" size={32} />,
    );
    expect(container.querySelector("[data-account-avatar]")?.outerHTML).toBe(
      expected.firstElementChild?.outerHTML,
    );
    expect(rowFor(main).querySelector("[data-account-avatar]")).toBeNull();
    expect(within(rowFor(main)).getByText("Rabby")).toBeInTheDocument();
  });

  it("takes Active and the bar off a chosen address that cannot sign here", () => {
    const signedOut = row("0x13af000000000000000000000000000000005cf7", {
      kind: "embedded",
      provider: "privy",
      brand: "Privy",
      connected: false,
      chosen: true,
      pendingStep: "connect",
      actions: [],
    });
    renderSettings([signedOut]);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(rowFor(signedOut).dataset.active).toBeUndefined();
    expect(
      within(rowFor(signedOut)).getByText("Sign in with Privy"),
    ).toBeInTheDocument();
  });

  it("shows the login's email, never a placeholder, on Privy", () => {
    const withEmail = { ...privyEvm, loginEmail: "aron@megyeri.eu" };
    const { unmount } = renderSettings([withEmail]);
    const provider = document.querySelector("[data-wallet-provider=privy]")!;
    // The login card names the email; its wallet row is "Privy", with the
    // email after the address.
    expect(
      within(provider as HTMLElement).getByText("aron@megyeri.eu"),
    ).toBeInTheDocument();
    expect(within(rowFor(withEmail)).getByText("Privy")).toBeInTheDocument();
    expect(rowFor(withEmail).textContent).toContain("· aron@megyeri.eu ·");
    unmount();

    renderSettings([privyEvm], {
      signInMethods: [
        { ...privy, email: undefined, displayLabel: "privy user" },
      ],
    });
    expect(screen.queryByText("privy user")).not.toBeInTheDocument();
    expect(screen.getByText("Signed in with Privy")).toBeInTheDocument();
    expect(screen.queryByText("EVM wallet")).not.toBeInTheDocument();
  });

  it("lays out Wallets and Sign-in wallets", () => {
    renderSettings([main, trading, metamask, privyEvm, privySvm]);
    expect(
      screen.getByText("Sign in by signing a message"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign-in wallets")).toBeInTheDocument();
    expect(screen.getByText("Privy and Para")).toBeInTheDocument();
    expect(screen.getAllByText("5 addresses · 3 on this device")).toHaveLength(
      2,
    );
  });

  it("titles a row with its name and puts the app beside it", () => {
    renderSettings([main, metamask]);
    expect(within(rowFor(main)).getByText("Main")).toBeInTheDocument();
    expect(within(rowFor(main)).getByText("Rabby")).toBeInTheDocument();
    expect(within(rowFor(metamask)).getByText("MetaMask")).toBeInTheDocument();
  });

  it("marks only the active row, with no other status labels", () => {
    renderSettings([main, trading, metamask]);
    expect(screen.getAllByText("Active")).toHaveLength(1);
    expect(within(rowFor(main)).getByText("Active")).toBeInTheDocument();
    for (const gone of ["Not linked", "Not on this device", "Address changed"])
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });

  it("names the step a row needs in its hover hint", () => {
    renderSettings([main, trading, metamask]);
    expect(
      within(rowFor(trading)).getByText("Switch in Rabby"),
    ).toBeInTheDocument();
    expect(
      within(rowFor(metamask)).getByText("Connect MetaMask"),
    ).toBeInTheDocument();
    expect(rowFor(main).querySelector("[data-hint]")).toBeNull();
  });

  it("activates a row by clicking it", () => {
    const onActivate = vi.fn();
    renderSettings([main, trading], { onActivate });
    fireEvent.click(
      screen.getByRole("button", {
        name: `Use Trading ${shortAddress(trading.address)}`,
      }),
    );
    expect(onActivate).toHaveBeenCalledWith(trading);
  });

  it("verifies a connected address that is not in the account", () => {
    const onVerify = vi.fn();
    const fresh = row("0x77c1000000000000000000000000000000000a20e", {
      linked: false,
      connected: false,
      linkedWalletId: undefined,
    });
    renderSettings([main], { onVerify, unlinked: fresh });
    fireEvent.click(
      within(rowFor(fresh)).getByRole("button", { name: "Verify" }),
    );
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("offers the address menu for an external wallet", async () => {
    const onRemove = vi.fn();
    const onDisconnect = vi.fn();
    const onRename = vi.fn(async () => true);
    renderSettings([main, trading], { onRemove, onDisconnect, onRename });
    openMenu(trading, "Trading");
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Use this walletOpens Rabby's account switch",
      "Rename",
      "Copy address",
      "View on explorer",
      `Remove from account${shortAddress(trading.address)} stops signing you in`,
    ]);

    openMenu(main, "Main");
    expect(
      screen.getByRole("menuitem", { name: "Disconnect on this device" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Remove from account/ }),
    );
    expect(onRemove).toHaveBeenCalledWith(main);
  });

  it("renames inline: Enter saves, Escape cancels", async () => {
    const onRename = vi.fn(async () => true);
    renderSettings([main], { onRename });
    openMenu(main, "Main");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", {
      name: `Name for ${shortAddress(main.address)}`,
    });
    fireEvent.change(input, { target: { value: "Savings" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();

    openMenu(main, "Main");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const again = screen.getByRole("textbox", {
      name: `Name for ${shortAddress(main.address)}`,
    });
    fireEvent.change(again, { target: { value: "Savings" } });
    await act(async () => {
      fireEvent.keyDown(again, { key: "Enter" });
    });
    expect(onRename).toHaveBeenCalledWith(main, "Savings");
    expect(screen.queryByRole("textbox", { name: /Name for/ })).toBeNull();
  });

  it("gives embedded wallets Use, Rename, Copy and View on explorer only", () => {
    renderSettings([privyEvm, privySvm], {
      onRename: vi.fn(async () => true),
      onRemove: vi.fn(),
      onDisconnect: vi.fn(),
    });
    openMenu(privyEvm, "Privy");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Use this wallet",
      "Rename",
      "Copy address",
      "View on explorer",
    ]);
  });

  it("offers sign-out and removal on the provider menu", () => {
    const onSignOutProvider = vi.fn();
    const onRemoveLogin = vi.fn();
    renderSettings([privyEvm, privySvm], { onSignOutProvider, onRemoveLogin });
    expect(screen.getByText("aron@megyeri.eu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Privy" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Sign out of Privy on this deviceStays in your account",
      "Copy email",
      "Remove Privy from accountIts 2 addresses are removed too",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Sign out of Privy/ }),
    );
    expect(onSignOutProvider).toHaveBeenCalledTimes(1);
  });

  it("opens the add sheet from the section header", () => {
    const onAddWallet = vi.fn();
    renderSettings([], { onAddWallet, signInMethods: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a wallet" }));
    expect(onAddWallet).toHaveBeenCalledTimes(1);
  });

  it("edits the account name in place", async () => {
    const onRenameAccount = vi.fn(async () => undefined);
    renderSettings([], { onRenameAccount, signInMethods: [] });
    fireEvent.click(screen.getByRole("button", { name: "Rename account" }));
    const input = screen.getByRole("textbox", { name: "Account display name" });
    fireEvent.change(input, { target: { value: "Aron Aomi" } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save account name" }),
      );
    });
    expect(onRenameAccount).toHaveBeenCalledWith("Aron Aomi");
  });

  it("uses the verified email over a generated provider name", () => {
    renderSettings([], {
      signInMethods: [],
      user: {
        id: "user-1",
        displayName: "Privy user",
        email: "cecilia@example.com",
      },
    });
    expect(screen.getByText("cecilia@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Privy user")).not.toBeInTheDocument();
  });
});

describe("Agent wallet group", () => {
  const AGENT = "0x7a3f00000000000000000000000000000000c41e";
  const EXTRA = "0x91c0000000000000000000000000000000000a11";
  const listed = (overrides: Record<string, unknown>) =>
    ({
      kind: "agent",
      family: "evm",
      label: "Agent wallet",
      custom_label: null,
      wallet_app: null,
      provider: "para",
      is_default: true,
      status: "ready",
      merged: false,
      created_at: 1_760_000_000,
      ...overrides,
    }) as AomiAccountWallet;
  const wallets = [
    listed({ id: "w_12", address: AGENT }),
    listed({ id: "w_31", address: EXTRA, is_default: false, merged: true }),
  ];
  const agentRow = row(AGENT, {
    kind: "agent",
    provider: "para",
    linkedWalletId: "12",
    connected: false,
    active: true,
    operating: true,
    brand: undefined,
    actions: [],
  });
  const extraRow = row(EXTRA, {
    kind: "agent",
    provider: "para",
    linkedWalletId: "31",
    connected: false,
    brand: undefined,
    actions: [],
  });
  const para = {
    id: "para-1",
    provider: "para",
    subject: "para-user",
    email: "aron@megyeri.eu",
  };
  const renderGroup = (
    agentWallets: Parameters<typeof AccountManagement>[0]["agentWallets"],
    extra: Partial<Parameters<typeof AccountManagement>[0]> = {},
  ) =>
    renderSettings([agentRow, extraRow, privyEvm], {
      signInMethods: [privy, para],
      agentWallets,
      ...extra,
    });
  const group = () =>
    document.querySelector("[data-agent-wallets]") as HTMLElement;
  const parentMenu = () => {
    fireEvent.click(
      within(group()).getByRole("button", { name: "Actions for agent wallet" }),
    );
    return screen.getByRole("menu", { name: "Actions for agent wallet" });
  };

  it("nests each agent address under one Agent wallet row, like a login", () => {
    const onActivate = vi.fn();
    renderGroup(
      { wallets, rule: { locked: false, version: 0 } },
      { onActivate },
    );
    expect(group().firstElementChild).toHaveTextContent(
      "Agent wallet" + "Aomi signs with it when you or a connection asks",
    );
    expect(within(group()).getByText("Asks before each trade")).toBeVisible();
    expect(within(rowFor(agentRow)).getByText("Active")).toBeInTheDocument();
    expect(rowFor(agentRow).textContent).toContain(
      `${shortAddress(AGENT)} · EVM`,
    );
    for (const gone of ["Deposit", "$412.80", "Create agent wallet"])
      expect(screen.queryByText(gone)).toBeNull();

    openMenu(extraRow, "Agent wallet");
    const items = within(
      screen.getByRole("menu", {
        name: `Actions for Agent wallet ${shortAddress(EXTRA)}`,
      }),
    )
      .getAllByRole("menuitem")
      .map((item) => item.querySelector("span")?.textContent);
    expect(items).toEqual([
      "Use this wallet",
      "Copy address",
      "View on explorer",
    ]);
    fireEvent.click(screen.getByText("Use this wallet"));
    expect(onActivate).toHaveBeenCalledWith(extraRow);
  });

  it("locks every agent wallet from the parent row, and unlocks", () => {
    const onLock = vi.fn();
    const { rerender } = renderGroup({
      wallets,
      rule: { locked: false, version: 3 },
      onLock,
    });
    const lock = within(parentMenu()).getByRole("menuitem", { name: /Lock/ });
    expect(lock).toHaveTextContent("Nothing signs until you unlock");
    fireEvent.click(lock);
    expect(onLock).toHaveBeenCalledWith(true);

    rerender(
      <AccountManagement
        user={{ id: "user-1", displayName: "Aron" }}
        rows={[agentRow, extraRow]}
        signInMethods={[]}
        pending={null}
        agentWallets={{ wallets, rule: { locked: true, version: 4 }, onLock }}
      />,
    );
    expect(within(group()).getByLabelText("Locked")).toBeInTheDocument();
    expect(within(group()).getByText("Locked · nothing signs")).toBeVisible();
    fireEvent.click(
      within(parentMenu()).getByRole("menuitem", { name: "Unlock" }),
    );
    expect(onLock).toHaveBeenLastCalledWith(false);
  });

  it("renames the agent wallet from the parent row", async () => {
    const onRename = vi.fn(async () => true);
    renderGroup({ wallets, rule: { locked: false, version: 0 }, onRename });
    fireEvent.click(within(parentMenu()).getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Agent wallet name" });
    fireEvent.change(input, { target: { value: "Trading" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onRename).toHaveBeenCalledWith("Trading");
  });

  it("keeps agent wallets out of the Para login group", () => {
    renderGroup({ wallets, rule: { locked: false, version: 0 } });
    expect(
      within(
        document.querySelector('[data-wallet-provider="para"]') as HTMLElement,
      ).queryByText(shortAddress(AGENT)),
    ).toBeNull();
  });

  it("is not shown without agent wallet support", () => {
    renderSettings([main]);
    expect(document.querySelector("[data-agent-wallets]")).toBeNull();
  });
});
