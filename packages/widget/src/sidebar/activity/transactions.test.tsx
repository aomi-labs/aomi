import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaseIcon, SolanaIcon } from "@/icons/chain-icons";
import type { ActivityTransaction } from "./model";
import { TransactionCard } from "./transactions";

function renderTransaction(overrides: Partial<ActivityTransaction>) {
  return render(
    <TransactionCard
      transaction={{
        id: "transaction",
        turnId: "turn",
        family: "svm",
        label: "Send SOL to self",
        kind: "transfer",
        raw: {},
        stage: "staged",
        ...overrides,
      }}
      executing={false}
      current={false}
    />,
  );
}

describe("transaction network chip", () => {
  it.each<[Partial<ActivityTransaction>, string, typeof SolanaIcon]>([
    [{ cluster: "mainnet-beta" }, "Solana", SolanaIcon],
    [{ cluster: "mainnet" }, "Solana", SolanaIcon],
    [{ cluster: "devnet" }, "Solana Devnet", SolanaIcon],
    [{ cluster: "testnet" }, "Solana Testnet", SolanaIcon],
    [{ cluster: "solana:mainnet" }, "Solana", SolanaIcon],
    [{ cluster: "solana:devnet" }, "Solana Devnet", SolanaIcon],
    [{ cluster: "solana:testnet" }, "Solana Testnet", SolanaIcon],
    [{ cluster: undefined }, "Solana", SolanaIcon],
    [{ cluster: "localnet", stage: "committed" }, "localnet", SolanaIcon],
    [{ family: "evm", chainId: 8453 }, "Base", BaseIcon],
  ])("shows the network for %j as %s", (overrides, label, Icon) => {
    renderTransaction(overrides);

    const chip = screen.getByTitle(label).parentElement;
    expect(chip).toHaveTextContent(label);
    expect(chip?.querySelector("svg")?.outerHTML).toBe(
      render(<Icon className="size-3 shrink-0" />).container.innerHTML,
    );
  });

  it("keeps the generic fallback for an unknown EVM chain", () => {
    renderTransaction({ family: "evm", chainId: 999999 });

    const chip = screen.getByTitle("Chain 999999").parentElement;
    expect(chip).toHaveTextContent("Chain 999999");
    expect(chip?.querySelector("svg circle")).not.toBeNull();
  });
});
