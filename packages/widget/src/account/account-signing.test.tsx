import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountSigningView } from "@/account/account-signing";
import type { WalletPolicy } from "@/account/types";
import type { AomiAuthorizationChallenge } from "@aomi-labs/client";

const challenge: AomiAuthorizationChallenge = {
  permit: {
    account: "test-account",
    chain_type: "evm",
    wallet: "0x1111111111111111111111111111111111111111",
    mode: "denied",
    version: 1,
    expiry: 1_800_000_000,
  },
  typed_data: {
    domain: { name: "Aomi Authorization", version: "1" },
    primaryType: "AuthorizationPermit",
    message: { mode: "denied" },
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
};

const paraAgent: WalletPolicy = {
  id: "para-agent",
  address: "0x2222222222222222222222222222222222222222",
  chain: "evm",
  linkedVia: "para",
  provider: "para",
  providerManaged: true,
  desiredMode: "auto",
  authVersion: 3,
};

function view(
  wallets: WalletPolicy[],
  onCommit = vi.fn(async () => {}),
  overrides: Partial<Parameters<typeof AccountSigningView>[0]> = {},
) {
  return (
    <AccountSigningView
      wallets={wallets}
      onCommit={onCommit}
      onPrepare={vi.fn(async () => challenge)}
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
    ["manual", "Locked", "denied"],
    ["denied", "Ask me", "manual"],
  ] as const)(
    "requires confirmation from %s to %s",
    async (from, label, to) => {
      const current = { ...wallet, desiredMode: from };
      const commit = vi.fn(async () => {});
      render(view([current], commit));
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
    const first = render(view([paraLogin], undefined, { onCreateAgentWallet }));
    const button = screen.getByRole("button", { name: "Create agent wallet" });
    expect(screen.getByText("Solana agent wallet")).toBeTruthy();
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
    render(view([paraLogin, agent], undefined, { onCreateAgentWallet }));
    expect(
      screen.queryAllByRole("button", { name: "Create agent wallet" }),
    ).toHaveLength(0);
  });
  it("Escape dismisses without signing and retry requires fresh confirmation", async () => {
    const commit = vi.fn(async () => {});
    render(view([wallet], commit));
    const dialog = await review("Locked");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await review("Locked");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects a stale review after the wallet policy refreshes", async () => {
    const commit = vi.fn(async () => {});
    const rendered = render(view([wallet], commit));
    await review("Locked");
    rendered.rerender(view([{ ...wallet, authVersion: 2 }], commit));
    await act(async () => fireEvent.click(screen.getByText("Sign to approve")));
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/Review the updated policy before signing/).length,
    ).toBeGreaterThan(0);
  });
  it("consumes confirmation once even if clicked twice", async () => {
    const commit = vi.fn(async () => {});
    render(view([wallet], commit));
    const dialog = await review("Locked");
    const confirm = within(dialog).getByText("Sign to approve");
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(commit).toHaveBeenCalledOnce();
  });
  it("gives every signable wallet the same Ask me / Locked choice", () => {
    const external: WalletPolicy = {
      ...wallet,
      id: "rabby-evm",
      linkedVia: "siwe",
      rdns: "io.rabby",
      provider: undefined,
    };
    render(view([external]));
    const group = screen.getByRole("radiogroup", {
      name: `Signing for Rabby ${external.address}`,
    });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Ask me",
      "Locked",
    ]);
    expect(
      radios.map((radio) => (radio as HTMLButtonElement).disabled),
    ).toEqual([false, false]);
  });
  it("shows an agent wallet's existing Automatic mode read-only and lets it be locked", async () => {
    const commit = vi.fn(async () => {});
    render(view([wallet, paraAgent], commit));
    const group = screen.getByRole("radiogroup", {
      name: `Signing for Para ${paraAgent.address}`,
    });
    const automatic = within(group).getByRole("radio", { name: "Automatic" });
    expect(automatic).toHaveAttribute("aria-checked", "true");
    // Choosing the saved mode again starts no ceremony.
    await act(async () => {
      fireEvent.click(automatic);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: "Locked" }));
    });
    const dialog = screen.getByRole("alertdialog", {
      name: "Confirm signing policy",
    });
    await act(async () =>
      fireEvent.click(within(dialog).getByText("Sign to approve")),
    );
    expect(commit).toHaveBeenCalledExactlyOnceWith(
      paraAgent,
      "denied",
      challenge,
    );
  });
  it("never offers Automatic to a locked agent wallet", () => {
    render(view([{ ...paraAgent, desiredMode: "denied" }]));
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Locked" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
  it("renders no automatic-signing or delegation controls", () => {
    render(
      view(
        [
          wallet,
          paraAgent,
          // A wallet still saved on a retired provider-delegated Auto.
          { ...wallet, id: "privy-auto", desiredMode: "auto" },
        ],
        undefined,
        { onCreateAgentWallet: vi.fn(async () => {}) },
      ),
    );
    for (const name of [
      "Fix",
      "Enable",
      "Set up",
      "Renew",
      "Manage",
      "Revoke delegation",
      "Revoke all",
      "Use for this session",
      "Turn off",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("radio", { name: "Auto" })).toBeNull();
    expect(screen.queryByText(/Automatic signing/)).toBeNull();
    expect(screen.queryByText(/delegation/i)).toBeNull();
  });
  it("explains a blocked change without preparing a permit", async () => {
    const prepare = vi.fn(async () => challenge);
    render(
      view([wallet], undefined, {
        onPrepare: prepare,
        blockedReason: () => "Connect a Ethereum wallet to sign this.",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Locked" }));
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connect a Ethereum wallet",
    );
    expect(screen.getByRole("radio", { name: "Ask me" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
