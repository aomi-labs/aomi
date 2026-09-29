import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedWallet } from "../wallet-management-model";
import { AccountManagement } from "./account-management";

const wallet = (
  address: string,
  family: "evm" | "svm",
  overrides: Partial<ManagedWallet> = {},
): ManagedWallet => ({
  key: `${family}:${address.toLowerCase()}`,
  id: address,
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
    { kind: "select", walletKey: `${family}:${address.toLowerCase()}` },
    { kind: "disconnect", connectionId: `connection:${address}` },
    { kind: "unlink", linkedWalletId: `linked:${address}` },
  ],
  ...overrides,
});

const props = (wallets: ManagedWallet[]) => ({
  user: { id: "user-1", displayName: "Aomi account" },
  wallets,
  signInMethods: [
    {
      id: "privy-1",
      provider: "privy",
      email: "cecilia@example.com",
    },
  ],
  canAddWallet: true,
  addSignInOptions: [],
  pending: null,
  onAddWallet: vi.fn(),
  onAddSignIn: vi.fn(),
  onSelectWallet: vi.fn(),
});

describe("account wallet language", () => {
  it("separates linked, active, and one selected wallet per family", () => {
    const selectedEvm = wallet(
      "0xdc27000000000000000000000000000000000e12",
      "evm",
      { provider: "privy", operating: true, actions: [] },
    );
    const otherEvm = wallet(
      "0x9fd4000000000000000000000000000000005c31",
      "evm",
      { provider: "metamask" },
    );
    const selectedSvm = wallet(
      "DUcPAX000000000000000000000000000007L4U",
      "svm",
      {
        provider: "privy",
        operating: true,
        actions: [],
      },
    );

    render(
      <AccountManagement {...props([selectedEvm, otherEvm, selectedSvm])} />,
    );

    expect(screen.getByText("Linked wallets")).toBeInTheDocument();
    expect(screen.getByText("Active wallets")).toBeInTheDocument();
    expect(screen.getByText("Selected wallets")).toBeInTheDocument();
    expect(screen.getAllByText("3 wallets")).toHaveLength(2);
    expect(
      screen.getByText("One EVM wallet and one Solana wallet"),
    ).toBeInTheDocument();
  });

  it("puts Link beside Disconnect for an active wallet not linked to the account", () => {
    const unlinked = wallet(
      "0x71f40000000000000000000000000000000039a8",
      "evm",
      {
        provider: "base wallet",
        linked: false,
        linkedWalletId: undefined,
        state: "unlinked",
        actions: [
          { kind: "link", connectionId: "base" },
          { kind: "disconnect", connectionId: "base" },
        ],
      },
    );
    render(
      <AccountManagement
        {...props([unlinked])}
        onLinkWallet={vi.fn()}
        onDisconnectWallet={vi.fn()}
      />,
    );

    const active = screen.getByText("Active wallets").closest("section");
    expect(active).not.toBeNull();
    expect(
      within(active!).getByRole("button", { name: "Link" }),
    ).toBeInTheDocument();
    expect(
      within(active!).getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("collapses providers and linked wallets as one account card", () => {
    render(<AccountManagement {...props([])} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse account" }));
    expect(screen.queryByText("Providers")).not.toBeInTheDocument();
    expect(screen.queryByText("Linked wallets")).not.toBeInTheDocument();
    expect(screen.getByText("Active wallets")).toBeInTheDocument();
  });

  it("keeps one visible selected-wallet slot for each network family", () => {
    render(<AccountManagement {...props([])} />);

    const selected = screen.getByText("Selected wallets").closest("section");
    expect(selected).not.toBeNull();
    expect(within(selected!).getByText("Ethereum")).toBeInTheDocument();
    expect(within(selected!).getByText("Solana")).toBeInTheDocument();
    expect(within(selected!).getAllByText("No wallet selected")).toHaveLength(
      2,
    );
  });
});
