import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiAccountWallet } from "@aomi-labs/client";
import {
  DepositSheet,
  chainBalanceLine,
  depositTargets,
  depositUri,
  depositWarning,
} from "./deposit-sheet";

const balances = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  refetch: vi.fn(async () => undefined),
}));
vi.mock("./use-agent-wallets", () => ({
  useWalletBalance: (_client: unknown, id: string | undefined) => ({
    data: id ? balances.data[id] : undefined,
    refetch: balances.refetch,
  }),
}));

const EVM = "0x7a3f00000000000000000000000000000000c41e";
const CHECKSUMMED = "0x7A3f00000000000000000000000000000000c41E";
const SOL = "7xKpQ1111111111111111111111111111111111111";

const wallet = (
  overrides: Partial<AomiAccountWallet> = {},
): AomiAccountWallet => ({
  id: "w_12",
  kind: "agent",
  family: "evm",
  address: EVM,
  label: "Agent wallet",
  custom_label: null,
  wallet_app: null,
  provider: "para",
  is_default: true,
  status: "ready",
  merged: false,
  rule: { mode: "ask", rule_version: 0, instant: [] },
  created_at: 1,
  ...overrides,
});
const evm = wallet();
const svm = wallet({ id: "w_13", family: "svm", address: SOL });
const chain = (id: number, name: string, native_symbol = "ETH") => ({
  chain: String(id),
  name,
  native_symbol,
  source: "indexed",
  native: null,
  tokens: [],
  error: null,
});

describe("deposit URIs and targets", () => {
  it("encodes EIP-681 with the checksummed address and chain id, and solana: for Solana", () => {
    const [base] = depositTargets({ evm, chains: [chain(8453, "Base")] });
    expect(depositUri(base!)).toBe(`ethereum:${CHECKSUMMED}@8453`);
    const [solana] = depositTargets({ svm });
    expect(depositUri(solana!)).toBe(`solana:${SOL}`);
  });

  it("puts Base first, then the server's chains, then Solana", () => {
    const targets = depositTargets({
      evm,
      svm,
      chains: [
        chain(1, "Ethereum"),
        chain(8453, "Base"),
        chain(4663, "Robinhood"),
      ],
    });
    expect(targets.map((target) => target.name)).toEqual([
      "Base",
      "Ethereum",
      "Robinhood",
      "Solana",
    ]);
  });

  it("falls back to Base before the balance has loaded", () => {
    expect(depositTargets({ evm }).map((target) => target.key)).toEqual([
      "evm:8453",
    ]);
  });

  it("warns per chain with its native gas token", () => {
    const [base, solana] = depositTargets({
      evm,
      svm,
      chains: [chain(8453, "Base")],
    });
    expect(depositWarning(base!)).toBe(
      "Send only on Base. Add about $2 of ETH for gas: the wallet pays its own gas for now.",
    );
    expect(depositWarning(solana!)).toBe(
      "Send only on Solana. Add about $2 of SOL for gas: the wallet pays its own gas for now.",
    );
  });

  it("states what the chain holds", () => {
    const [base] = depositTargets({ evm, chains: [chain(8453, "Base")] });
    expect(chainBalanceLine(base!, undefined)).toBe("Checking Base…");
    expect(
      chainBalanceLine(base!, {
        ...chain(8453, "Base"),
        native: { amount: "0.004", usd: "10.20" },
        tokens: [
          { symbol: "USDC", address: "0x1", amount: "402.60", usd: "402.60" },
        ],
      }),
    ).toBe("On Base: 0.004 ETH · 402.60 USDC");
    expect(
      chainBalanceLine(base!, { ...chain(8453, "Base"), error: "unavailable" }),
    ).toBe("Couldn’t read Base right now.");
  });
});

describe("DepositSheet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    balances.refetch.mockClear();
    balances.data = {
      w_12: {
        id: "w_12",
        family: "evm",
        address: EVM,
        as_of: 1,
        total_usd: null,
        chains: [chain(1, "Ethereum"), chain(8453, "Base")],
      },
    };
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("shows the QR, address and warning for each tab, copies, and polls while open", async () => {
    const onClose = vi.fn();
    render(<DepositSheet wallet={evm} companion={svm} onClose={onClose} />);
    expect(
      screen.getByRole("dialog", { name: "Deposit to Agent wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Funds Aomi can trade with on your behalf"),
    ).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Base", "Ethereum", "Solana"]);
    expect(screen.getByRole("tab", { name: "Base" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const qr = () => document.querySelector("[data-qr]")!;
    expect(qr().getAttribute("data-qr")).toBe(`ethereum:${CHECKSUMMED}@8453`);
    expect(qr().querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
    expect(document.querySelector("[data-deposit-address]")?.textContent).toBe(
      CHECKSUMMED,
    );
    expect(
      document.querySelector("[data-deposit-warning]")?.textContent,
    ).toContain("Send only on Base.");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Copy address ${CHECKSUMMED}` }),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CHECKSUMMED);

    fireEvent.click(screen.getByRole("tab", { name: "Ethereum" }));
    expect(qr().getAttribute("data-qr")).toBe(`ethereum:${CHECKSUMMED}@1`);

    fireEvent.click(screen.getByRole("tab", { name: "Solana" }));
    expect(qr().getAttribute("data-qr")).toBe(`solana:${SOL}`);
    expect(
      document.querySelector("[data-deposit-warning]")?.textContent,
    ).toContain("Add about $2 of SOL");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(balances.refetch).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("opens a Solana wallet on its own tab", () => {
    render(<DepositSheet wallet={svm} companion={evm} onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Solana" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("offers only its own chains for an extra wallet", () => {
    render(
      <DepositSheet
        wallet={wallet({
          id: "w_31",
          label: "Hoodit wallet",
          is_default: false,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("tab", { name: "Solana" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Deposit to Hoodit wallet" }),
    ).toBeInTheDocument();
  });
});
