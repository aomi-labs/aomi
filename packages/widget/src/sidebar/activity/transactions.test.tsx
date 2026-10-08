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
  it.each([
    ["mainnet-beta", "Solana"],
    ["mainnet", "Solana"],
    ["devnet", "Solana Devnet"],
    ["testnet", "Solana Testnet"],
    ["solana:mainnet", "Solana"],
    ["solana:devnet", "Solana Devnet"],
    ["solana:testnet", "Solana Testnet"],
    [undefined, "Solana"],
  ])("shows the Solana mark and friendly label for %s", (cluster, label) => {
    renderTransaction({ cluster });

    const chip = screen.getByTitle(label).parentElement;
    expect(chip).toHaveTextContent(label);
    expect(chip?.querySelector("svg")?.outerHTML).toBe(
      render(<SolanaIcon className="size-3 shrink-0" />).container.innerHTML,
    );
  });

  it("keeps a custom SVM cluster visible beside the Solana mark", () => {
    renderTransaction({ cluster: "localnet", stage: "committed" });

    const chip = screen.getByTitle("localnet").parentElement;
    expect(chip).toHaveTextContent("localnet");
    expect(chip?.querySelector("svg")?.outerHTML).toBe(
      render(<SolanaIcon className="size-3 shrink-0" />).container.innerHTML,
    );
  });

  it("keeps the EVM chain name and mark", () => {
    renderTransaction({ family: "evm", chainId: 8453 });

    const chip = screen.getByTitle("Base").parentElement;
    expect(chip).toHaveTextContent("Base");
    expect(chip?.querySelector("svg")?.outerHTML).toBe(
      render(<BaseIcon className="size-3 shrink-0" />).container.innerHTML,
    );
  });

  it("keeps the generic fallback for an unknown EVM chain", () => {
    renderTransaction({ family: "evm", chainId: 999999 });

    const chip = screen.getByTitle("Chain 999999").parentElement;
    expect(chip).toHaveTextContent("Chain 999999");
    expect(chip?.querySelector("svg circle")).not.toBeNull();
  });
});
