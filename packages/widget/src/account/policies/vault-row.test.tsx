import {
  act,
  cleanup,
  fireEvent,
  render,
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
const token = (symbol: string, decimals: number, asset: VaultToken["asset"]) =>
  ({ symbol, decimals, asset }) as VaultToken;
const USDC = token("USDC", 6, {
  erc20: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
});
const USDT = token("USDT", 6, {
  erc20: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
});
const ETH = token("ETH", 18, { native: true });
const TOKENS = [USDC, USDT, ETH];
const held = (usdc: number, eth = "980000000000000000"): VaultHolding[] => [
  { token: USDC, raw: BigInt(usdc) },
  { token: USDT, raw: BigInt(0) },
  { token: ETH, raw: BigInt(eth) },
];
const BALANCES = held(95_000_000);
const SHOWN = "USDC 95.00 · ETH 0.98";

afterEach(cleanup);

async function show(extra: Partial<Parameters<typeof VaultRow>[0]> = {}) {
  const readBalances = vi.fn(async (_: readonly VaultToken[]) => BALANCES);
  const withdraw = vi.fn(async (..._: unknown[]) => "sent" as const);
  await act(async () => {
    render(
      <VaultRow
        vault={VAULT}
        tokens={TOKENS}
        readBalances={readBalances}
        withdraw={withdraw as never}
        signer={{ canSign: true, hint: null }}
        retryDelayMs={0}
        {...extra}
      />,
    );
  });
  const row = document.querySelector("[data-vault]") as HTMLElement;
  const q = within(row);
  const button = (name: string) => q.getByRole("button", { name });
  return {
    row,
    q,
    button,
    readBalances,
    withdraw: withdraw as ReturnType<typeof vi.fn>,
    open: async () => {
      await waitFor(() => expect(button("Withdraw")).toBeEnabled());
      fireEvent.click(button("Withdraw"));
    },
    amount: () => q.getByRole("textbox", { name: "Amount" }),
    type: (value: string) =>
      fireEvent.change(q.getByRole("textbox", { name: "Amount" }), {
        target: { value },
      }),
    click: (name: string) => fireEvent.click(button(name)),
  };
}

describe("the vault row", () => {
  it("shows the vault, its chain and what it holds, leaving out a zero balance, with the form closed", async () => {
    let release: (holdings: VaultHolding[]) => void = () => undefined;
    const pending = new Promise<VaultHolding[]>((r) => (release = r));
    const { row, q, button } = await show({ readBalances: () => pending });
    expect(row).toHaveTextContent("Vault");
    expect(q.getByRole("link", { name: /0x7c4c…e079/ })).toHaveAttribute(
      "href",
      VAULT.explorer,
    );
    expect(q.getByRole("img")).toHaveAttribute("aria-label", "Base");
    expect(row).toHaveTextContent("Reading the balance…");
    await act(async () => release(BALANCES));
    expect(row).toHaveTextContent(SHOWN);
    expect(row).not.toHaveTextContent("USDT");
    expect(q.queryByRole("textbox")).toBeNull();
    expect(button("Withdraw")).toHaveAttribute("aria-expanded", "false");
  });

  it("reads once, opens with a chip per held token, and Max fills that token's exact balance", async () => {
    const { row, q, open, amount, click, readBalances } = await show();
    expect(readBalances).toHaveBeenCalledTimes(1);
    expect(readBalances).toHaveBeenCalledWith(TOKENS);
    await open();
    const chips = within(q.getByRole("group", { name: "Token" })).getAllByRole(
      "button",
    );
    expect(chips.map((chip) => chip.textContent)).toEqual(["USDC", "ETH"]);
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
    expect(row).toHaveTextContent(
      "Valid for 10 minutes. You pay the network fee.",
    );
    const buttons = q.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Sign and send")).toBeLessThan(
      buttons.indexOf("Cancel"),
    );
    click("Max");
    expect(amount()).toHaveValue("95");
    click("ETH");
    expect(amount()).toHaveValue("");
    click("Max");
    expect(amount()).toHaveValue("0.98");
  });

  it.each([
    ["USDC", "12.5", USDC.asset, BigInt(12_500_000)],
    ["ETH", "0.1", { native: true }, BigInt("100000000000000000")],
  ])(
    "withdraws %s in base units, shows Withdrawn. and reads again until the balance changes",
    async (symbol, value, asset, raw) => {
      const { row, q, button, open, type, click, readBalances, withdraw } =
        await show();
      await open();
      click(symbol);
      type(value);
      // The first two reads after the send still show the old balances.
      readBalances
        .mockResolvedValueOnce(BALANCES)
        .mockResolvedValueOnce(BALANCES)
        .mockResolvedValue(held(82_500_000));
      click("Sign and send");
      expect(button("Waiting for wallet…")).toBeDisabled();
      await waitFor(() => expect(row).toHaveTextContent("Withdrawn."));
      expect(withdraw).toHaveBeenCalledTimes(1);
      expect(withdraw).toHaveBeenCalledWith(asset, raw);
      await waitFor(() =>
        expect(row).toHaveTextContent("USDC 82.50 · ETH 0.98"),
      );
      expect(readBalances).toHaveBeenCalledTimes(4);
      expect(q.queryByRole("textbox")).toBeNull();
      expect(q.queryByRole("alert")).toBeNull();
    },
  );

  it("refuses zero, more than the balance, and text that is not a number, before the wallet", async () => {
    const { row, q, open, type, click, withdraw } = await show();
    await open();
    for (const [value, message] of [
      ["0", "The amount must be above 0."],
      ["95.01", "That is more than the vault holds of USDC."],
      ["abc", "Enter an amount, like 12.5."],
      ["", "Enter an amount, like 12.5."],
    ] as const) {
      type(value);
      click("Sign and send");
      expect(row).toHaveTextContent(message);
      expect(q.queryByRole("alert")).toBeNull();
    }
    expect(withdraw).not.toHaveBeenCalled();
    type("1");
    expect(row).not.toHaveTextContent("Enter an amount");
  });

  it.each([
    ["Transaction reverted", "Transaction reverted"],
    [
      "User rejected the request.",
      "Declined in your wallet. Nothing was withdrawn.",
    ],
  ])(
    "shows the wallet error %j as %j, keeps the form, and can try again",
    async (error, shown) => {
      const { row, q, button, open, amount, type, click, withdraw } =
        await show();
      withdraw.mockRejectedValueOnce(new Error(error));
      await open();
      type("5");
      click("Sign and send");
      expect(await q.findByRole("alert")).toHaveTextContent(shown);
      expect(amount()).toHaveValue("5");
      expect(button("Sign and send")).toBeEnabled();
      expect(row).not.toHaveTextContent("Withdrawn.");
      click("Sign and send");
      await waitFor(() => expect(row).toHaveTextContent("Withdrawn."));
      expect(q.queryByRole("alert")).toBeNull();
    },
  );

  it("says the vault is not created yet, with no form, when it has no code", async () => {
    const { row, q, open, type, click, withdraw } = await show();
    withdraw.mockResolvedValueOnce("no_vault");
    await open();
    type("5");
    click("Sign and send");
    await waitFor(() =>
      expect(row).toHaveTextContent(
        "Nothing to withdraw yet. Your vault is created with your first trade.",
      ),
    );
    expect(q.queryByRole("textbox")).toBeNull();
    expect(q.queryByRole("button", { name: "Sign and send" })).toBeNull();
    expect(row).not.toHaveTextContent("Withdrawn.");
  });

  it("closes with Cancel and forgets the amount", async () => {
    const { q, open, amount, type, click, withdraw } = await show();
    await open();
    type("5");
    click("Cancel");
    expect(q.queryByRole("textbox")).toBeNull();
    click("Withdraw");
    expect(amount()).toHaveValue("");
    expect(withdraw).not.toHaveBeenCalled();
  });

  it.each([
    [
      "names the owner's wallet when another is connected",
      { signer: { canSign: false, hint: "Connect 0x3e14…6dde to sign." } },
      "Connect 0x3e14…6dde to sign.",
    ],
    [
      "says the vault is empty",
      { readBalances: async () => held(0, "0") },
      "Nothing in the vault.",
    ],
  ])("disables Withdraw and %s", async (_, extra, text) => {
    const { row, button } = await show(extra);
    await waitFor(() => expect(row).toHaveTextContent(text));
    expect(button("Withdraw")).toBeDisabled();
  });

  it("says when the balance cannot be read, and reads it again on Try again", async () => {
    const readBalances = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValue(BALANCES);
    const { row, button, click } = await show({ readBalances });
    await waitFor(() =>
      expect(row).toHaveTextContent("Couldn’t read the balance."),
    );
    expect(button("Withdraw")).toBeDisabled();
    click("Try again");
    await waitFor(() => expect(row).toHaveTextContent(SHOWN));
    expect(row).not.toHaveTextContent("Couldn’t read");
  });

  it("reads again when the tokens change, not for the same tokens in a new array", async () => {
    const readBalances = vi.fn(async (_: readonly VaultToken[]) =>
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
    rerender(view([ETH]));
    rerender(view([USDC, ETH]));
    await waitFor(() => expect(readBalances).toHaveBeenCalledTimes(2));
    expect(readBalances).toHaveBeenLastCalledWith([USDC, ETH]);
  });
});
