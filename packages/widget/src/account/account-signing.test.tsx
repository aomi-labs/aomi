import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LockedWalletsView } from "@/account/account-signing";
import type { WalletPolicy } from "@/account/types";
import type { AomiAuthorizationChallenge } from "@aomi-labs/client";

const challenge: AomiAuthorizationChallenge = {
  permit: {
    account: "test-account",
    chain_type: "evm",
    wallet: "0x1111111111111111111111111111111111111111",
    mode: "manual",
    version: 1,
    expiry: 1_800_000_000,
  },
  typed_data: {
    domain: { name: "Aomi Authorization", version: "1" },
    primaryType: "AuthorizationPermit",
    message: { mode: "manual" },
  },
};

/** A browser wallet Locked before agent wallets existed. */
const locked: WalletPolicy = {
  id: "rabby-evm",
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  linkedVia: "siwe",
  rdns: "io.rabby",
  desiredMode: "denied",
  authVersion: 1,
};

function view(
  wallets: WalletPolicy[],
  onCommit = vi.fn(async () => {}),
  overrides: Partial<Parameters<typeof LockedWalletsView>[0]> = {},
) {
  return (
    <LockedWalletsView
      wallets={wallets}
      onCommit={onCommit}
      onPrepare={vi.fn(async () => challenge)}
      {...overrides}
    />
  );
}

async function unlock() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Unlock / }));
  });
  return screen.getByRole("alertdialog", { name: "Confirm signing policy" });
}

describe("Locked wallets", () => {
  it("lists a Locked wallet compactly with Unlock and nothing else", () => {
    render(view([locked]));
    expect(
      screen.getByRole("heading", { name: "Locked wallets" }),
    ).toBeTruthy();
    expect(screen.getByText("Rabby")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unlock / })).toBeEnabled();
    // The per-wallet Ask me / Locked choice is gone.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/Automatic/)).toBeNull();
  });

  it("unlocks only after the reviewed permit is signed", async () => {
    const commit = vi.fn(async () => {});
    render(view([locked], commit));
    const dialog = await unlock();
    expect(commit).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(locked.address);
    expect(
      JSON.parse(
        within(dialog).getByLabelText("Payload to sign").textContent ?? "",
      ),
    ).toEqual(challenge.typed_data);
    await act(async () =>
      fireEvent.click(within(dialog).getByText("Sign to approve")),
    );
    expect(commit).toHaveBeenCalledExactlyOnceWith(locked, "manual", challenge);
  });

  it("Escape dismisses without signing and Unlock asks again", async () => {
    const commit = vi.fn(async () => {});
    const prepare = vi.fn(async () => challenge);
    render(view([locked], commit, { onPrepare: prepare }));
    const dialog = await unlock();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    await unlock();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a stale review after the wallet policy refreshes", async () => {
    const commit = vi.fn(async () => {});
    const rendered = render(view([locked], commit));
    await unlock();
    rendered.rerender(view([{ ...locked, authVersion: 2 }], commit));
    await act(async () => fireEvent.click(screen.getByText("Sign to approve")));
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Review the updated policy before signing/),
    ).toBeTruthy();
  });

  it("consumes confirmation once even if clicked twice", async () => {
    const commit = vi.fn(async () => {});
    render(view([locked], commit));
    const confirm = within(await unlock()).getByText("Sign to approve");
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("explains a blocked unlock without preparing a permit", async () => {
    const prepare = vi.fn(async () => challenge);
    render(
      view([locked], undefined, {
        onPrepare: prepare,
        blockedReason: () => "Connect a Ethereum wallet to sign this.",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Unlock / }));
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connect a Ethereum wallet",
    );
  });
});
