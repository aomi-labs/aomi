import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountSigningView } from "../../../../shadcn-registry/src/components/account-shell/features/account/account-signing";
import type { WalletPolicy } from "../../../../shadcn-registry/src/components/account-shell/features/account/types";
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
function view(
  current: WalletPolicy,
  onCommit = vi.fn(async () => {}),
  overrides: Partial<Parameters<typeof AccountSigningView>[0]> = {},
) {
  return (
    <AccountSigningView
      wallets={[current]}
      delegatedAccounts={[]}
      onCommit={onCommit}
      onPrepare={vi.fn(async () => challenge)}
      onRevokeDelegation={vi.fn()}
      onStopAllAuto={vi.fn()}
      canConnectPrivy={false}
      onConnectPrivy={vi.fn()}
      onRenewDelegation={vi.fn()}
      {...overrides}
    />
  );
}
async function review(label: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `Configure ${wallet.address}` }),
  );
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
  it("moves automatic signing out of the normal policy choices", async () => {
    const commit = vi.fn(async () => {});
    render(view(wallet, commit));

    fireEvent.click(
      screen.getByRole("button", { name: `Configure ${wallet.address}` }),
    );
    expect(
      screen.queryByRole("button", { name: /^Automatic signing / }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Confirm signing policy",
    });
    await act(async () =>
      fireEvent.click(within(dialog).getByText("Sign to approve")),
    );
    expect(commit).toHaveBeenCalledExactlyOnceWith(wallet, "auto", challenge);
  });
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
      screen.getAllByText(/Review the updated policy before signing/).length,
    ).toBeGreaterThan(0);
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
  it("shows a failed automatic delegation revoke on the affected wallet", async () => {
    const delegation = {
      id: "privy-delegation",
      provider: "Privy",
      providerKey: "privy",
      address: { chain: "evm" as const, address: wallet.address },
      scope: "EVM",
      kind: "provider",
      status: "active" as const,
    };
    const revoke = vi.fn(async () => {
      throw new Error("Delegation could not be revoked. Try again.");
    });
    render(
      view(
        { ...wallet, desiredMode: "auto", delegationActive: true },
        undefined,
        { delegatedAccounts: [delegation], onRevokeDelegation: revoke },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Revoke delegation" }),
      ),
    );
    expect(revoke).toHaveBeenCalledExactlyOnceWith(delegation);
    const row = document.getElementById(`automatic-wallet-${wallet.id}`)!;
    expect(
      within(row).getByText("Delegation could not be revoked. Try again."),
    ).toBeTruthy();
    expect(
      within(row)
        .getByRole("button", { name: "Revoke delegation" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("directs attention to a drifted automatic wallet and opens its controls", () => {
    vi.useFakeTimers();
    try {
      const scrollTo = vi.fn();
      const rendered = render(
        <div className="overflow-y-auto">
          {view({ ...wallet, desiredMode: "auto", delegationActive: false })}
        </div>,
      );
      const container = rendered.container.querySelector(".overflow-y-auto")!;
      Object.defineProperty(container, "scrollTo", { value: scrollTo });
      fireEvent.click(screen.getByRole("button", { name: "Fix" }));
      const row = document.getElementById(`automatic-wallet-${wallet.id}`)!;
      expect(
        within(row).getByRole("button", { name: "Turn off" }),
      ).toBeTruthy();
      expect(row.className).toContain("ring-1");
      act(() => vi.advanceTimersByTime(80));
      expect(scrollTo).toHaveBeenCalledOnce();
      act(() => vi.advanceTimersByTime(1520));
      expect(row.className).not.toContain("ring-1");
    } finally {
      vi.useRealTimers();
    }
  });
});
