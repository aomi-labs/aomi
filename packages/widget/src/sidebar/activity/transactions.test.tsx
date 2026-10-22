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
    ["mainnet-beta", { cluster: "mainnet-beta" }, "Solana", SolanaIcon],
    ["mainnet", { cluster: "mainnet" }, "Solana", SolanaIcon],
    ["devnet", { cluster: "devnet" }, "Solana Devnet", SolanaIcon],
    ["testnet", { cluster: "testnet" }, "Solana Testnet", SolanaIcon],
    ["solana:mainnet", { cluster: "solana:mainnet" }, "Solana", SolanaIcon],
    ["solana:devnet", { cluster: "solana:devnet" }, "Solana Devnet", SolanaIcon],
    [
      "solana:testnet",
      { cluster: "solana:testnet" },
      "Solana Testnet",
      SolanaIcon,
    ],
    ["no cluster", { cluster: undefined }, "Solana", SolanaIcon],
    // A custom SVM cluster stays visible beside the Solana mark.
    [
      "custom localnet",
      { cluster: "localnet", stage: "committed" },
      "localnet",
      SolanaIcon,
    ],
    ["EVM chain 8453", { family: "evm", chainId: 8453 }, "Base", BaseIcon],
  ] as const)(
    "shows the network mark and friendly label for %s",
    (_name, overrides, label, Icon) => {
      renderTransaction(overrides as Partial<ActivityTransaction>);

      const chip = screen.getByTitle(label).parentElement;
      expect(chip).toHaveTextContent(label);
      expect(chip?.querySelector("svg")?.outerHTML).toBe(
        render(<Icon className="size-3 shrink-0" />).container.innerHTML,
      );
    },
  );

  it("keeps the generic fallback for an unknown EVM chain", () => {
    renderTransaction({ family: "evm", chainId: 999999 });

    const chip = screen.getByTitle("Chain 999999").parentElement;
    expect(chip).toHaveTextContent("Chain 999999");
    expect(chip?.querySelector("svg circle")).not.toBeNull();
  });
});
