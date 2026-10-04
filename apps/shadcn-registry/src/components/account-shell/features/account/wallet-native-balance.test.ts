import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  readNativeBalance,
  type NativeBalanceTarget,
  WalletNativeBalance,
} from "./wallet-native-balance";
import type { ManagedWallet } from "./wallet-management-model";

vi.mock("../../../../lib/wallet-kit/context", () => ({
  useAomiWalletKit: () => ({
    identity: { chainId: 1 },
    supportedChains: [
      {
        id: 1,
        name: "Ethereum",
        nativeCurrency: { symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["https://configured-render.example"] } },
      },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const target: NativeBalanceTarget = {
  family: "evm",
  address: "0x0000000000000000000000000000000000000001",
  rpcUrl: "https://configured.example",
  network: "Ethereum",
  symbol: "ETH",
  decimals: 18,
};

describe("native balance reads", () => {
  it("avoids rereads on adapter churn and preserves the last balance on refresh failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: "0xde0b6b3a7640000" }))
      .mockRejectedValueOnce(new Error("unavailable"));
    vi.stubGlobal("fetch", fetch);
    const wallet = {
      address: target.address,
      family: "evm",
      chainId: 1,
      operating: true,
    } as ManagedWallet;
    const view = render(createElement(WalletNativeBalance, { wallet }));
    await screen.findByText("1 ETH · Ethereum");
    view.rerender(
      createElement(WalletNativeBalance, { wallet: { ...wallet } }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Refresh balance for ${wallet.address}`,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "1 ETH · Ethereum · last known",
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reads real zero and nonzero EVM amounts without invoking a signer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: "0x0" }))
      .mockResolvedValueOnce(Response.json({ result: "0xde0b6b3a7640000" }));
    vi.stubGlobal("fetch", fetch);
    expect(await readNativeBalance(target)).toBe("0");
    expect(await readNativeBalance(target)).toBe("1");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      method: "eth_getBalance",
      params: [target.address, "latest"],
    });
  });
  it("uses the configured Solana read and rejects missing or malformed balances", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ result: { value: 1_500_000_000 } }),
        )
        .mockResolvedValueOnce(Response.json({ result: {} }))
        .mockResolvedValueOnce(
          Response.json({ error: { message: "unavailable" } }),
        ),
    );
    expect(
      await readNativeBalance({
        ...target,
        family: "svm",
        address: "SolanaAddress",
        symbol: "SOL",
        decimals: 9,
      }),
    ).toBe("1.5");
    await expect(readNativeBalance(target)).rejects.toThrow(
      "Invalid balance response",
    );
    await expect(readNativeBalance(target)).rejects.toThrow(
      "Balance unavailable",
    );
  });
});
