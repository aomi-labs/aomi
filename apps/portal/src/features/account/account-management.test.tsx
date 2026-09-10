import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountManagement } from "./account-management";
import type { UnifiedAccountWallet } from "./wallet-management-model";

const connectedWallet: UnifiedAccountWallet = {
  key: "evm:0xda65",
  family: "evm",
  address: "0xda65",
  walletName: "Rabby",
  connected: true,
  linked: true,
  active: true,
};

const linkedWallet: UnifiedAccountWallet = {
  key: "evm:0xe9ba",
  family: "evm",
  address: "0xe9ba",
  walletName: "MetaMask 1",
  connected: false,
  linked: true,
  active: false,
  accountWalletId: "wallet-2",
};

const inactiveWallet: UnifiedAccountWallet = {
  key: "evm:0xc0ff",
  family: "evm",
  address: "0xc0ff",
  walletName: "Coinbase Wallet",
  connected: true,
  linked: true,
  active: false,
};

describe("AccountManagement wallet actions", () => {
  it("opens the canonical wallet chooser from Add wallet", () => {
    const onAddWallet = vi.fn();
    render(
      <AccountManagement
        user={{ id: "user-1", displayName: "Aron" }}
        wallets={[]}
        signInMethods={[]}
        canAddWallet
        addSignInOptions={[]}
        pending={null}
        onAddWallet={onAddWallet}
        onAddSignIn={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add wallet" }));

    expect(onAddWallet).toHaveBeenCalledTimes(1);
  });

  it("edits the account name in place without relabeling the row", async () => {
    const onRenameAccount = vi.fn(async () => undefined);
    render(
      <AccountManagement
        user={{ id: "user-1", displayName: "Aron" }}
        wallets={[connectedWallet, inactiveWallet, linkedWallet]}
        signInMethods={[]}
        canAddWallet={false}
        addSignInOptions={[]}
        pending={null}
        onRenameAccount={onRenameAccount}
        onAddWallet={() => undefined}
        onAddSignIn={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename account" }));
    const input = screen.getByRole("textbox", {
      name: "Account display name",
    });
    expect(input).toHaveValue("Aron");
    expect(screen.queryByText("Account name")).toBeNull();
    expect(
      screen.getByText("3 linked wallets · 1 not connected on this device"),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "Aron Aomi" } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save account name" }),
      );
    });
    expect(onRenameAccount).toHaveBeenCalledWith("Aron Aomi");
  });

  it("cancels an in-place name edit", () => {
    render(
      <AccountManagement
        user={{ id: "user-1", displayName: "Aron" }}
        wallets={[]}
        signInMethods={[]}
        canAddWallet={false}
        addSignInOptions={[]}
        pending={null}
        onRenameAccount={async () => undefined}
        onAddWallet={() => undefined}
        onAddSignIn={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename account" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Account display name" }),
      { target: { value: "Temporary" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel account name edit" }),
    );

    expect(screen.getByText("Aron")).toBeTruthy();
    expect(screen.queryByDisplayValue("Temporary")).toBeNull();
  });

  it("shows Connect with an icon for offline wallets and Disconnect for live wallets", () => {
    const onConnectWallet = vi.fn(async () => undefined);
    const onDisconnectWallet = vi.fn(async () => undefined);
    const onSelectWallet = vi.fn(async () => undefined);

    render(
      <AccountManagement
        user={{ id: "user-1", displayName: "Aron" }}
        wallets={[connectedWallet, inactiveWallet, linkedWallet]}
        signInMethods={[]}
        canAddWallet={false}
        addSignInOptions={[]}
        pending={null}
        onAddWallet={() => undefined}
        onAddSignIn={async () => undefined}
        onConnectWallet={onConnectWallet}
        onDisconnectWallet={onDisconnectWallet}
        onSelectWallet={onSelectWallet}
      />,
    );

    const connect = screen.getByRole("button", { name: "Connect" });
    const disconnect = screen.getAllByRole("button", {
      name: "Disconnect",
    })[0];
    expect(connect.querySelector("svg")).toBeTruthy();
    expect(disconnect.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(
      screen.getByText("3 linked wallets · 1 not connected on this device"),
    ).toBeTruthy();

    const selectWallet = screen.getByRole("button", {
      name: "Make Coinbase Wallet active",
    });
    expect(
      document.querySelector('[data-wallet-state="active"]')?.className,
    ).toContain("bg-aomi-success");
    expect(
      document.querySelector('[data-wallet-state="connected"]')?.className,
    ).not.toContain("bg-aomi-success");
    expect(
      document.querySelector('[data-wallet-state="connected"]')?.className,
    ).toContain("hover:bg-aomi-hover");

    fireEvent.click(connect);
    fireEvent.click(disconnect);
    fireEvent.click(selectWallet);
    expect(onConnectWallet).toHaveBeenCalledWith(linkedWallet);
    expect(onDisconnectWallet).toHaveBeenCalledWith(connectedWallet);
    expect(onSelectWallet).toHaveBeenCalledWith(inactiveWallet);
  });
});
