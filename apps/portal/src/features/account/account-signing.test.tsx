import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountSigningView } from "./account-signing";
import type { WalletPolicy } from "./types";
import type { AomiAuthorizationChallenge } from "@aomi-labs/client";

const challenge: AomiAuthorizationChallenge = {
  permit: {
    account: "test-account",
    chain_type: "evm",
    wallet: "0x1111111111111111111111111111111111111111",
    mode: "client_auto",
    version: 1,
    expiry: 1_800_000_000,
  },
  typed_data: {
    domain: { name: "Aomi Authorization", version: "1" },
    primaryType: "AuthorizationPermit",
    message: { mode: "client_auto" },
  },
};

const wallet: WalletPolicy = {
  id: "privy-evm",
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  linkedVia: "privy",
  provider: "privy",
  desiredMode: "manual",
  authVersion: 1,
  canUseAuto: true,
};
function view(current: WalletPolicy, onCommit = vi.fn(async () => {})) {
  return (
    <AccountSigningView
      wallets={[current]}
      delegatedAccounts={[]}
      unboundWallets={[]}
      onCommit={onCommit}
      onPrepare={vi.fn(async () => challenge)}
      onBindWallet={vi.fn()}
      onRevokeDelegation={vi.fn()}
      onStopAllAuto={vi.fn()}
      canConnectPrivy={false}
      onConnectPrivy={vi.fn()}
      onRenewDelegation={vi.fn()}
    />
  );
}
async function review(label: string) {
  fireEvent.click(screen.getByText("Privy"));
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${label} `) }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
  });
  return screen.getByRole("dialog", { name: "Confirm signing policy" });
}

describe("policy confirmation", () => {
  it.each([
    ["manual", "Auto-approve", "client_auto"],
    ["client_auto", "Manual", "manual"],
    ["manual", "Auto", "auto"],
    ["manual", "Locked", "denied"],
  ] as const)(
    "requires confirmation from %s to %s",
    async (from, label, to) => {
      const current = { ...wallet, desiredMode: from };
      const commit = vi.fn(async () => {});
      render(view(current, commit));
      const dialog = await review(label);
      expect(commit).not.toHaveBeenCalled();
      expect(dialog.textContent).toContain(wallet.address);
      expect(
        JSON.parse(
          within(dialog).getByLabelText("Payload to sign").textContent ?? "",
        ),
      ).toEqual(challenge.typed_data);
      await act(async () =>
        fireEvent.click(within(dialog).getByText("Sign to approve")),
      );
      expect(commit).toHaveBeenCalledExactlyOnceWith(current, to, challenge);
    },
  );
  it("Escape dismisses without signing and retry requires fresh confirmation", async () => {
    const commit = vi.fn(async () => {});
    render(view(wallet, commit));
    const dialog = await review("Auto-approve");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects a stale review after the wallet policy refreshes", async () => {
    const commit = vi.fn(async () => {});
    const rendered = render(view(wallet, commit));
    await review("Auto-approve");
    rendered.rerender(view({ ...wallet, authVersion: 2 }, commit));
    await act(async () => fireEvent.click(screen.getByText("Sign to approve")));
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Review the updated policy before signing/),
    ).toBeTruthy();
  });
  it("consumes confirmation once even if clicked twice", async () => {
    const commit = vi.fn(async () => {});
    render(view(wallet, commit));
    const dialog = await review("Auto-approve");
    const confirm = within(dialog).getByText("Sign to approve");
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(commit).toHaveBeenCalledOnce();
  });
});
