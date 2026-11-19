import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultRow } from "./vault-row";
import type { Vault, VaultHolding, VaultToken } from "./vault-model";

const VAULT: Vault = {
  key: "8453:0x7c4c1f0a2b3d4e5f60718293a4b5c6d7e8f9e079",
  address: "0x7c4c1f0a2b3d4e5f60718293a4b5c6d7e8f9e079",
  chainId: 8453,
  chain: { label: "Base", network: "eip155:8453" },
  owner: "0x3e14a1b2c3d4e5f60718293a4b5c6d7e8f906dde",
  explorer:
    "https://basescan.org/address/0x7c4c1f0a2b3d4e5f60718293a4b5c6d7e8f9e079",
};
const USDC: VaultToken = {
  symbol: "USDC",
  decimals: 6,
  asset: { erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
};
const USDT: VaultToken = {
  symbol: "USDT",
  decimals: 6,
  asset: { erc20: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" },
};
const ETH: VaultToken = {
  symbol: "ETH",
  decimals: 18,
  asset: { native: true },
};
const TOKENS = [USDC, USDT, ETH];
const held = (usdc: number, usdt: number, eth: string): VaultHolding[] => [
  { token: USDC, raw: BigInt(usdc) },
  { token: USDT, raw: BigInt(usdt) },
  { token: ETH, raw: BigInt(eth) },
];
const BALANCES = held(95_000_000, 0, "980000000000000000");

afterEach(cleanup);

type Overrides = Partial<Parameters<typeof VaultRow>[0]>;
async function show(extra: Overrides = {}) {
  const readBalances = vi.fn(
    async (_tokens: readonly VaultToken[]) => BALANCES,
  );
  const withdraw = vi.fn(
    async (..._args: unknown[]) => "sent" as "sent" | "no_vault",
  );
  const props = {
    vault: VAULT,
    tokens: TOKENS,
    readBalances,
    withdraw,
    signer: { canSign: true, hint: null },
    retryDelayMs: 0,
    ...extra,
  };
  await act(async () => {
    render(<VaultRow {...props} />);
  });
  const row = document.querySelector("[data-vault]") as HTMLElement;
  return {
    row,
    readBalances: props.readBalances as typeof readBalances,
    withdraw: props.withdraw as typeof withdraw,
  };
}
const open = async (row: HTMLElement) => {
  await waitFor(() =>
    expect(within(row).getByRole("button", { name: "Withdraw" })).toBeEnabled(),
  );
  fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
};
const type = (row: HTMLElement, value: string) =>
  fireEvent.change(within(row).getByRole("textbox", { name: "Amount" }), {
    target: { value },
  });
const sign = (row: HTMLElement) =>
  fireEvent.click(within(row).getByRole("button", { name: "Sign and send" }));

describe("the vault row", () => {
  it("shows the vault, its chain and what it holds, leaving out a zero balance", async () => {
    let release: (holdings: VaultHolding[]) => void = () => undefined;
    const pending = new Promise<VaultHolding[]>((resolve) => {
      release = resolve;
    });
    const { row } = await show({ readBalances: () => pending });
    expect(row).toHaveTextContent("Vault");
    expect(
      within(row).getByRole("link", { name: /0x7c4c…e079/ }),
    ).toHaveAttribute("href", VAULT.explorer);
    expect(within(row).getByRole("img")).toHaveAttribute("aria-label", "Base");
    expect(row).toHaveTextContent("Reading the balance…");
    await act(async () => release(BALANCES));
    expect(row).toHaveTextContent("USDC 95.00 · ETH 0.98");
    expect(row).not.toHaveTextContent("USDT");
    // The form is closed until Withdraw.
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(
      within(row).getByRole("button", { name: "Withdraw" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reads each token once, on first show", async () => {
    const { readBalances } = await show();
    expect(readBalances).toHaveBeenCalledTimes(1);
    expect(readBalances).toHaveBeenCalledWith(TOKENS);
  });

  it("opens inline with a chip for each token held, an amount and the copy", async () => {
    const { row } = await show();
    await open(row);
    const chips = within(
      within(row).getByRole("group", { name: "Token" }),
    ).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["USDC", "ETH"]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("aria-pressed", "false");
    expect(within(row).getByRole("textbox", { name: "Amount" })).toBeTruthy();
    expect(row).toHaveTextContent(
      "Valid for 10 minutes. You pay the network fee.",
    );
    const buttons = within(row)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toContain("Max");
    expect(buttons.indexOf("Sign and send")).toBeLessThan(
      buttons.indexOf("Cancel"),
    );
  });

  it("fills the whole balance of the picked token with Max", async () => {
    const { row } = await show();
    await open(row);
    fireEvent.click(within(row).getByRole("button", { name: "Max" }));
    expect(within(row).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "95",
    );
    fireEvent.click(within(row).getByRole("button", { name: "ETH" }));
    // Another token starts with an empty amount, and Max is its own balance.
    expect(within(row).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "",
    );
    fireEvent.click(within(row).getByRole("button", { name: "Max" }));
    expect(within(row).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "0.98",
    );
  });

  it("hands the token and the amount in base units to the withdrawal, then shows Withdrawn. and reads the balances again", async () => {
    const { row, readBalances, withdraw } = await show();
    await open(row);
    type(row, "12.5");
    readBalances.mockResolvedValue(held(82_500_000, 0, "980000000000000000"));
    sign(row);
    expect(
      within(row).getByRole("button", { name: "Waiting for wallet…" }),
    ).toBeDisabled();
    await waitFor(() => expect(row).toHaveTextContent("Withdrawn."));
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledWith(USDC.asset, BigInt(12_500_000));
    await waitFor(() => expect(row).toHaveTextContent("USDC 82.50 · ETH 0.98"));
    expect(readBalances).toHaveBeenCalledTimes(2);
    // The form closed, with nothing left in it.
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it("sends the native coin by its own asset", async () => {
    const { row, withdraw } = await show();
    await open(row);
    fireEvent.click(within(row).getByRole("button", { name: "ETH" }));
    type(row, "0.1");
    sign(row);
    await waitFor(() => expect(withdraw).toHaveBeenCalled());
    expect(withdraw).toHaveBeenCalledWith(
      { native: true },
      BigInt("100000000000000000"),
    );
  });

  it("reads again while the balances still show the old amount", async () => {
    const { row, readBalances } = await show();
    await open(row);
    type(row, "1");
    // The first two reads after the send are the old balances.
    readBalances
      .mockResolvedValueOnce(BALANCES)
      .mockResolvedValueOnce(BALANCES)
      .mockResolvedValue(held(94_000_000, 0, "980000000000000000"));
    sign(row);
    await waitFor(() => expect(row).toHaveTextContent("USDC 94.00 · ETH 0.98"));
    expect(readBalances).toHaveBeenCalledTimes(4);
  });

  it("refuses an amount of zero, more than the balance, and text that is not a number, before the wallet", async () => {
    const { row, withdraw } = await show();
    await open(row);
    for (const [value, message] of [
      ["0", "The amount must be above 0."],
      ["95.01", "That is more than the vault holds of USDC."],
      ["abc", "Enter an amount, like 12.5."],
      ["", "Enter an amount, like 12.5."],
    ] as const) {
      type(row, value);
      sign(row);
      expect(row).toHaveTextContent(message);
      expect(within(row).queryByRole("alert")).toBeNull();
    }
    expect(withdraw).not.toHaveBeenCalled();
    // The message goes once the amount is changed.
    type(row, "1");
    expect(row).not.toHaveTextContent("Enter an amount");
  });

  it("shows a wallet's error in an alert and keeps the form as it was", async () => {
    const { row, withdraw } = await show();
    withdraw.mockRejectedValueOnce(new Error("Transaction reverted"));
    await open(row);
    type(row, "5");
    sign(row);
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Transaction reverted",
    );
    expect(within(row).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "5",
    );
    expect(
      within(row).getByRole("button", { name: "Sign and send" }),
    ).toBeEnabled();
    expect(row).not.toHaveTextContent("Withdrawn.");
    // Trying again clears the alert, and a second try can succeed.
    sign(row);
    await waitFor(() => expect(row).toHaveTextContent("Withdrawn."));
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it("says plainly when the owner declined in the wallet", async () => {
    const { row, withdraw } = await show();
    withdraw.mockRejectedValueOnce(new Error("User rejected the request."));
    await open(row);
    type(row, "5");
    sign(row);
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Declined in your wallet. Nothing was withdrawn.",
    );
  });

  it("says the vault is not created yet, with no form, when it has no code", async () => {
    const { row, withdraw } = await show();
    withdraw.mockResolvedValueOnce("no_vault");
    await open(row);
    type(row, "5");
    sign(row);
    await waitFor(() =>
      expect(row).toHaveTextContent(
        "Nothing to withdraw yet. Your vault is created with your first trade.",
      ),
    );
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(
      within(row).queryByRole("button", { name: "Sign and send" }),
    ).toBeNull();
    expect(row).not.toHaveTextContent("Withdrawn.");
  });

  it("closes with Cancel and forgets the amount", async () => {
    const { row, withdraw } = await show();
    await open(row);
    type(row, "5");
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Withdraw" }));
    expect(within(row).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "",
    );
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("disables Withdraw and names the wallet to connect when it is not the owner's", async () => {
    const { row } = await show({
      signer: { canSign: false, hint: "Connect 0x3e14…6dde to sign." },
    });
    await waitFor(() => expect(row).toHaveTextContent("USDC 95.00 · ETH 0.98"));
    expect(
      within(row).getByRole("button", { name: "Withdraw" }),
    ).toBeDisabled();
    expect(row).toHaveTextContent("Connect 0x3e14…6dde to sign.");
  });

  it("disables Withdraw for an empty vault", async () => {
    const { row } = await show({
      readBalances: async () => held(0, 0, "0"),
    });
    await waitFor(() => expect(row).toHaveTextContent("Nothing in the vault."));
    expect(
      within(row).getByRole("button", { name: "Withdraw" }),
    ).toBeDisabled();
  });

  it("says when the balance cannot be read, and reads it again on Try again", async () => {
    const readBalances = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValue(BALANCES);
    const { row } = await show({ readBalances });
    await waitFor(() =>
      expect(row).toHaveTextContent("Couldn’t read the balance."),
    );
    expect(
      within(row).getByRole("button", { name: "Withdraw" }),
    ).toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row).toHaveTextContent("USDC 95.00 · ETH 0.98"));
    expect(row).not.toHaveTextContent("Couldn’t read");
  });

  it("reads again when the tokens it may hold change, as the catalog arrives", async () => {
    const readBalances = vi.fn(async (_tokens: readonly VaultToken[]) =>
      BALANCES.slice(2),
    );
    const view = (tokens: readonly VaultToken[]) => (
      <VaultRow
        vault={VAULT}
        tokens={tokens}
        readBalances={readBalances}
        withdraw={async () => "sent"}
        signer={{ canSign: true, hint: null }}
      />
    );
    const { rerender } = render(view([ETH]));
    await waitFor(() => expect(readBalances).toHaveBeenCalledTimes(1));
    // The same tokens in a new array do not read again.
    rerender(view([ETH]));
    rerender(view([USDC, ETH]));
    await waitFor(() => expect(readBalances).toHaveBeenCalledTimes(2));
    expect(readBalances).toHaveBeenLastCalledWith([USDC, ETH]);
  });
});
