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
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: label }));
  });
  return screen.getByRole("alertdialog", { name: "Confirm signing policy" });
}

describe("policy confirmation", () => {
  it.each([
    ["manual", "Auto", "client_auto"],
    ["client_auto", "Ask me", "manual"],
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
  it("offers to create a Para agent wallet for a chain that has only the login wallet", async () => {
    const paraLogin: WalletPolicy = {
      id: "para-svm-login",
      address: "BdMAnLogin1111111111111111111111111111111111",
      chain: "svm",
      linkedVia: "para",
      provider: "para",
      desiredMode: "manual",
      authVersion: 1,
    };
    const onCreateAgentWallet = vi.fn(async () => {});
    const first = render(view(paraLogin, undefined, { onCreateAgentWallet }));
    const button = screen.getByRole("button", { name: "Create agent wallet" });
    expect(screen.getByText("Enable automatic signing on Solana")).toBeTruthy();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onCreateAgentWallet).toHaveBeenCalledWith("svm");
    first.unmount();

    // Once the agent wallet exists the offer disappears.
    const agent: WalletPolicy = {
      ...paraLogin,
      id: "para-svm-agent",
      address: "3TWBeAgent111111111111111111111111111111111",
      providerManaged: true,
      desiredMode: "denied",
    };
    render(
      <AccountSigningView
        wallets={[paraLogin, agent]}
        delegatedAccounts={[]}
        onCommit={vi.fn()}
        onPrepare={vi.fn(async () => challenge)}
        onRevokeDelegation={vi.fn()}
        onStopAllAuto={vi.fn()}
        canConnectPrivy={false}
        onConnectPrivy={vi.fn()}
        onRenewDelegation={vi.fn()}
        onCreateAgentWallet={onCreateAgentWallet}
      />,
    );
    expect(
      screen.queryAllByRole("button", { name: "Create agent wallet" }),
    ).toHaveLength(0);
  });

  it("offers Renew on a Para agent wallet whose delegation was revoked, even when Locked", async () => {
    const revokedAgent: WalletPolicy = {
      id: "para-svm-agent",
      address: "3TWBeAgent111111111111111111111111111111111",
      chain: "svm",
      linkedVia: "para",
      provider: "para",
      providerManaged: true,
      desiredMode: "denied",
      delegationActive: false,
      authVersion: 2,
    };
    const onRenewDelegation = vi.fn(async () => {});
    render(view(revokedAgent, undefined, { onRenewDelegation }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    });
    expect(onRenewDelegation).toHaveBeenCalledWith(revokedAgent);
    expect(screen.queryByText("Not enabled")).toBeNull();
  });

  it("moves automatic signing out of the normal policy choices", async () => {
    const commit = vi.fn(async () => {});
    render(view(wallet, commit));

    expect(
      screen.queryByRole("radio", { name: "Automatic signing" }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    });
    const dialog = await screen.findByRole("alertdialog", {
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
    const dialog = await review("Auto");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await review("Auto");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects a stale review after the wallet policy refreshes", async () => {
    const commit = vi.fn(async () => {});
    const rendered = render(view(wallet, commit));
    await review("Auto");
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
    const dialog = await review("Auto");
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
  it("offers Ask me and Locked, but not Auto, for an external wallet", () => {
    const external: WalletPolicy = {
      ...wallet,
      id: "rabby-evm",
      linkedVia: "siwe",
      rdns: "io.rabby",
      provider: undefined,
      canUseAuto: false,
    };
    render(view(external));
    const group = screen.getByRole("radiogroup", {
      name: `Signing for Rabby ${external.address}`,
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Ask me", "Locked"]);
    expect(screen.queryByText("Automatic signing")).toBeNull();
  });
  it("keeps Auto for a provider wallet and leaves agent wallets to automatic signing", () => {
    render(
      <AccountSigningView
        wallets={[
          wallet,
          {
            ...wallet,
            id: "para-agent",
            address: "0x2222222222222222222222222222222222222222",
            linkedVia: "para",
            provider: "para",
            providerManaged: true,
          },
        ]}
        delegatedAccounts={[]}
        onCommit={vi.fn()}
        onPrepare={vi.fn()}
        onRevokeDelegation={vi.fn()}
        onStopAllAuto={vi.fn()}
        canConnectPrivy={false}
        onConnectPrivy={vi.fn()}
        onRenewDelegation={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Auto" })).toBeTruthy();
    expect(
      document.getElementById("automatic-wallet-para-agent"),
    ).not.toBeNull();
  });
  it("explains a blocked change without preparing a permit", async () => {
    const prepare = vi.fn(async () => challenge);
    render(
      view(wallet, undefined, {
        onPrepare: prepare,
        blockedReason: () =>
          "Connect this wallet itself to widen what it may sign.",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connect this wallet itself",
    );
    expect(screen.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
