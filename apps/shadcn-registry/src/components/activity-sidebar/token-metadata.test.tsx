import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const readContract = vi.hoisted(() => vi.fn());
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({ readContract }),
}));
import { ImpactPanel } from "./wallet-impact";
import { readTokenMetadata } from "./token-metadata";
import type { ActionRequest } from "@aomi-labs/client";
const address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const chain = {
  id: 8453,
  name: "Base",
  rpcUrls: { default: { http: ["https://example.test/base"] } },
};
afterEach(cleanup);

describe("missing ERC-20 metadata", () => {
  it("resolves an address and raw units into USDC and its decimal amount", async () => {
    readContract.mockImplementation(async ({ functionName }) =>
      functionName === "decimals"
        ? 6
        : functionName === "symbol"
          ? "USDC"
          : "USD Coin",
    );
    const change = {
      asset: address,
      amount: "10000",
      direction: "out" as const,
      standard: "erc20" as const,
      chainId: 8453,
    };
    const request: ActionRequest = {
      type: "execute_evm",
      transactions: [],
      simulation: {
        status: "passed",
        balanceChanges: [change],
        approvals: [],
        fees: [],
        guards: [],
        logs: [],
        warnings: [],
        gas: null,
      },
    };
    render(
      <ImpactPanel
        request={request}
        balanceChanges={[change]}
        approvals={[]}
        supportedChains={[chain]}
        showNetwork
        failed={false}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("−0.01 USDC")).toBeInTheDocument(),
    );
    expect(screen.getByTitle("USDC")).toBeInTheDocument();
    expect(screen.getByLabelText("−0.01 USDC")).toHaveClass("text-aomi-danger");
    expect(
      screen.getByRole("region", { name: "Simulated wallet impact" }).innerHTML,
    ).not.toContain("min-h-[104px]");
    await readTokenMetadata(chain, address.toLowerCase());
    expect(readContract).toHaveBeenCalledTimes(3);
  });
  it("does not guess symbol or decimals when the configured RPC is unavailable", async () => {
    readContract.mockRejectedValue(new Error("unavailable"));
    const result = await readTokenMetadata({ ...chain, id: 1 }, address);
    expect(result.symbol).toBeUndefined();
    expect(result.decimals).toBeUndefined();
  });
});
