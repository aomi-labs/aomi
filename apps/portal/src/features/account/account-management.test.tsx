import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountManagement } from "../../../../shadcn-registry/src/components/account-shell/features/account/account-management";
import type { ManagedWallet } from "../../../../shadcn-registry/src/components/account-shell/features/account/wallet-management-model";

const connectedWallet: ManagedWallet = {
  key: "evm:0xda65",
  family: "evm",
  address: "0xda65",
  kind: "external",
  walletName: "Rabby",
  state: "ready",
  connected: true,
  linked: true,
  operating: true,
  connectionId: "rabby",
  linkedWalletId: "wallet-1",
  actions: [
    { kind: "disconnect", connectionId: "rabby" },
    { kind: "unlink", linkedWalletId: "wallet-1" },
  ],
};

const linkedWallet: ManagedWallet = {
  key: "evm:0xe9ba",
  family: "evm",
  address: "0xe9ba",
  kind: "external",
  walletName: "MetaMask 1",
  state: "offline",
  reason: "disconnected",
  connected: false,
  linked: true,
  operating: false,
  linkedWalletId: "wallet-2",
  actions: [
    { kind: "connect", walletKey: "evm:0xe9ba" },
    { kind: "unlink", linkedWalletId: "wallet-2" },
  ],
};

const inactiveWallet: ManagedWallet = {
  key: "evm:0xc0ff",
  family: "evm",
  address: "0xc0ff",
  kind: "external",
  walletName: "Coinbase Wallet",
  state: "ready",
  connected: true,
  linked: true,
  operating: false,
  connectionId: "coinbase",
  linkedWalletId: "wallet-3",
  actions: [
    { kind: "select", walletKey: "evm:0xc0ff" },
    { kind: "disconnect", connectionId: "coinbase" },
    { kind: "unlink", linkedWalletId: "wallet-3" },
  ],
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

    fireEvent.click(screen.getByRole("button", { name: "Edit account" }));
    const input = screen.getByRole("textbox", {
      name: "Account display name",
    });
    expect(input).toHaveValue("Aron");
    expect(screen.queryByText("Account name")).toBeNull();
    expect(screen.getByText("0 providers · 3 linked wallets")).toBeTruthy();

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

    fireEvent.click(screen.getByRole("button", { name: "Edit account" }));
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
    expect(screen.getByText("0 providers · 3 linked wallets")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const selectWallet = screen.getByRole("button", {
      name: /0xc0ff Coinbase/,
    });

    fireEvent.click(connect);
    fireEvent.click(disconnect);
    fireEvent.click(selectWallet);
    expect(onConnectWallet).toHaveBeenCalledWith(linkedWallet);
    expect(onDisconnectWallet).toHaveBeenCalledWith(connectedWallet);
    expect(onSelectWallet).toHaveBeenCalledWith(inactiveWallet);
  });
});
