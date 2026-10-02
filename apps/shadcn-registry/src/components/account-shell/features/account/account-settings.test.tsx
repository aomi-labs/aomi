import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "./account-settings";

const fixture = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
}));
const saved = "0x1111111111111111111111111111111111111111";
vi.mock("../../../../lib/wallet-kit/context", () => ({
  useAomiWalletKit: () => ({
    identity: { isConnected: true },
    accountUser: { id: "signed-in-user", displayName: "Test account" },
    wallets: [
      {
        key: `evm:${saved}`,
        family: "evm",
        address: saved,
        kind: "external",
        walletName: "Rabby",
        state: "offline",
        reason: "disconnected",
        connected: false,
        linked: true,
        operating: false,
        linkedWalletId: "saved-wallet",
        actions: [{ kind: "connect", walletKey: `evm:${saved}` }],
      },
    ],
    evmWallets: [{ id: "rabby", label: "Rabby", family: "evm" }],
    connectEvmWallet: fixture.connect,
  }),
}));
vi.mock("./use-account-acl", () => ({
  useAccountAcl: () => ({
    wallets: [],
    status: "ready",
    refresh: fixture.refresh,
  }),
}));

afterEach(() => {
  cleanup();
  fixture.connect.mockReset();
  fixture.refresh.mockClear();
});
describe("saved wallet Connect", () => {
  it("passes the saved address to the connector recovery path", async () => {
    render(<AccountSettings />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connect", exact: true }),
    );
    await waitFor(() =>
      expect(fixture.connect).toHaveBeenCalledWith("rabby", {
        expectedAddress: saved,
      }),
    );
    await waitFor(() => expect(fixture.refresh).toHaveBeenCalledOnce());
  });
  it("keeps an actionable mismatch visible and releases pending state for retry", async () => {
    fixture.connect.mockRejectedValueOnce(
      new Error("Select 0x1111…1111 in Rabby, then click Connect again."),
    );
    render(<AccountSettings />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connect", exact: true }),
    );
    await screen.findByText(
      "Select 0x1111…1111 in Rabby, then click Connect again.",
    );
    expect(screen.getByText("Test account")).toBeVisible();
    expect(
      screen.getByText("Not on this device", { exact: true }),
    ).toBeVisible();
    expect(fixture.refresh).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect", exact: true }),
    );
    await waitFor(() => expect(fixture.refresh).toHaveBeenCalledOnce());
    expect(fixture.connect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Select .* in Rabby/)).toBeNull();
  });
});
