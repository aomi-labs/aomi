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
import { shortAddress } from "@aomi-labs/client";
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
    const provider = document.querySelector(
      "[data-wallet-provider=privy]",
    ) as HTMLElement;
    // One address: the login is that address row, "Privy" with the email
    // after the address, and nothing to expand.
    expect(
      within(provider).queryByRole("button", { name: /Privy addresses/ }),
    ).toBeNull();
    expect(provider.querySelectorAll("[data-wallet-row]")).toHaveLength(1);
    expect(within(rowFor(withEmail)).getByText("Privy")).toBeInTheDocument();
    expect(rowFor(withEmail).textContent).toContain("· aron@megyeri.eu ·");
    unmount();

    renderSettings([privyEvm, privySvm], {
      signInMethods: [
        { ...privy, email: undefined, displayLabel: "privy user" },
      ],
    });
    expect(screen.queryByText(/privy user/)).not.toBeInTheDocument();
    expect(
      screen.getByText("2 addresses · EVM/SVM"),
    ).toBeInTheDocument();
    expect(screen.queryByText("EVM wallet")).not.toBeInTheDocument();
  });

  it("lists every wallet you sign with under one Sign-in wallets band", () => {
    renderSettings([main, trading, metamask, privyEvm, privySvm]);
    expect(screen.getAllByText("Sign-in wallets")).toHaveLength(1);
    expect(
      screen.getByText("You sign with these yourself"),
    ).toBeInTheDocument();
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
      "Make active",
      "Rename",
      "Copy address",
      "View on explorer",
      "Remove from account",
    ]);
    // The destructive item sits alone after a separator.
    const menu = screen.getByRole("menu");
    expect(menu.lastElementChild?.previousElementSibling).toHaveAttribute(
      "role",
      "separator",
    );

    openMenu(main, "Main");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Rename",
      "Copy address",
      "View on explorer",
      "Sign out on this device",
      "Remove from account",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from account" }),
    );
    expect(onRemove).toHaveBeenCalledWith(main);
  });

  it("renames in a dialog: Cancel discards, Enter saves", async () => {
    const onRename = vi.fn(async () => true);
    renderSettings([main], { onRename });
    openMenu(main, "Main");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename wallet" });
    const input = within(dialog).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("Main");
    // Unchanged, there is nothing to save.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "Savings" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    openMenu(main, "Main");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const again = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(again, { target: { value: "Savings" } });
    await act(async () => {
      fireEvent.submit(again);
    });
    expect(onRename).toHaveBeenCalledWith(main, "Savings");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("gives embedded wallets Make active, Rename, Copy and View on explorer only", () => {
    renderSettings([privyEvm, privySvm], {
      onRename: vi.fn(async () => true),
      onRemove: vi.fn(),
      onDisconnect: vi.fn(),
    });
    openMenu(privyEvm, "Privy");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Make active", "Rename", "Copy address", "View on explorer"]);
  });

  it("offers sign-out and removal on the provider menu", () => {
    const onSignOutProvider = vi.fn();
    const onRemoveLogin = vi.fn();
    renderSettings([privyEvm, privySvm], { onSignOutProvider, onRemoveLogin });
    expect(
      screen.getByText("2 addresses · EVM/SVM"),
    ).toBeInTheDocument();
    // Open while one of its addresses is Active; the chevron folds it.
    const toggle = screen.getByRole("button", {
      name: "Hide Privy addresses",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(rowFor(privySvm)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(rowFor(privySvm)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show Privy addresses" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Privy" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Copy email", "Sign out on this device", "Remove from account"]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Sign out on this device" }),
    );
    expect(onSignOutProvider).toHaveBeenCalledTimes(1);
  });

  it("opens the add sheet from the section header", () => {
    const onAddWallet = vi.fn();
    renderSettings([], { onAddWallet, signInMethods: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a wallet" }));
    expect(onAddWallet).toHaveBeenCalledTimes(1);
  });

  it("renames the account from the profile menu", async () => {
    const onRenameAccount = vi.fn(async () => undefined);
    renderSettings([], {
      onRenameAccount,
      signInMethods: [],
      user: { id: "user-1", displayName: "Aron", email: "aron@megyeri.eu" },
    });
    expect(screen.queryByRole("button", { name: "Rename account" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for your account" }),
    );
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Rename", "Copy email"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename account" });
    const input = within(dialog).getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Aron Aomi" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(onRenameAccount).toHaveBeenCalledWith("Aron Aomi");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

describe("Agent wallets band", () => {
  it("sits at the bottom of the wallets card, below the sign-in wallets", () => {
    renderSettings([main], {
      agentWallets: <div data-testid="agent-band">Agent wallets</div>,
    });
    const card = screen.getByTestId("agent-band").parentElement!;
    expect(card.lastElementChild).toBe(screen.getByTestId("agent-band"));
    expect(card.textContent?.indexOf("Sign-in wallets")).toBeLessThan(
      card.textContent?.indexOf("Agent wallets") ?? -1,
    );
  });

  it("is not shown without agent wallet support", () => {
    renderSettings([main]);
    expect(screen.queryByText("Agent wallets")).toBeNull();
  });
});
