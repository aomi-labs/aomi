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
    type: (value: string) =>
      fireEvent.change(q.getByRole("textbox", { name: "Amount" }), {
        target: { value },
      }),
    click: (name: string) => fireEvent.click(button(name)),
  };
}

describe("the vault row", () => {
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
});
