import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action, runtime, simulation } from "./test-fixtures";
import { ActivitySidebar } from "./activity-sidebar";

describe("WalletReview", () => {
  beforeEach(() => {
    runtime.isRunning = false;
    runtime.pendingActions = [];
    runtime.events = [];
    runtime.turnState = undefined;
    runtime.executeAction.mockReset().mockResolvedValue(undefined);
    runtime.rejectAction.mockReset().mockResolvedValue(undefined);
    runtime.showNotification.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(cleanup);

  it("requires explicit approval before executing an EVM Action", async () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        simulation: simulation(),
        transactions: [
          {
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Transfer",
            kind: "transfer",
          },
        ],
      }),
    ];
    runtime.events = runtime.pendingActions;
    runtime.turnState = "awaiting_action";

    render(<ActivitySidebar />);

    expect(runtime.executeAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "0x2222222222222222222222222222222222222222",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
    await waitFor(() =>
      expect(runtime.executeAction).toHaveBeenCalledWith("action-1"),
    );
  });

  it("keeps wallet failures local instead of reporting user rejection", async () => {
    runtime.executeAction.mockRejectedValue(new Error("wallet unavailable"));
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        simulation: simulation(),
        transactions: [
          {
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Transfer",
            kind: "transfer",
          },
        ],
      }),
    ];

    render(<ActivitySidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));

    await waitFor(() =>
      expect(runtime.showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "wallet unavailable" }),
      ),
    );
    expect(runtime.rejectAction).not.toHaveBeenCalled();
  });

  it("requires explicit approval for attended signing Actions", async () => {
    runtime.pendingActions = [
      action({
        type: "sign",
        requestId: "sign-1",
        chainFamily: "evm",
        executionKind: "erc4337",
        broadcaster: "hosted",
        sponsorship: "required",
        maxNetworkFee: "123456",
        signer: "0x1111111111111111111111111111111111111111",
        chainId: 1,
        description: "Authorize account execution",
        payloads: [{ kind: "evm_personal", message: "0x01" }],
        fees: [
          {
            asset: { kind: "native" },
            amount: "42",
            recipient: "0x2222222222222222222222222222222222222222",
          },
        ],
      }),
    ];

    render(<ActivitySidebar />);
    expect(runtime.executeAction).not.toHaveBeenCalled();
    expect(screen.getByText("hosted")).toBeInTheDocument();
    expect(screen.getByText("Sponsorship required")).toBeInTheDocument();
    expect(screen.getByText("123456 native base units")).toBeInTheDocument();
    expect(screen.getByText("Application fee")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));

    await waitFor(() =>
      expect(runtime.executeAction).toHaveBeenCalledWith("action-1"),
    );
  });

  it("renders the canonical simulation nested in an Action request", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Transfer",
            kind: "transfer",
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [
            {
              account: "0x1111111111111111111111111111111111111111",
              asset: "native",
              amount: "1",
              direction: "out",
              symbol: "ETH",
              standard: "native",
            },
          ],
          approvals: [],
          fees: [],
          gas: { units: "21000", priceWei: null, nativeCost: null },
          logs: [],
          warnings: [],
          guards: [],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.queryByTestId("action-simulation")).not.toBeInTheDocument();
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "Estimated gas · 21,000 units",
    );
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "−0.000000000000000001 ETH",
    );
    expect(
      screen
        .getByTestId("asset-effect")
        .querySelector('[data-asset-icon="eth"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Simulated wallet impact" }),
    ).not.toHaveClass("sm:grid-cols-2");
  });

  it("pairs token names and tickers with exact decimal display amounts", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x01",
            label: "Withdraw USDC",
            kind: "withdraw",
          },
        ],
        simulation: {
          ...simulation(),
          balanceChanges: [
            {
              account: "0x1111111111111111111111111111111111111111",
              asset: "0x3333333333333333333333333333333333333333",
              amount: "100000",
              direction: "out",
              standard: "erc20",
              name: "Aave Base USDC",
              symbol: "aBasUSDC",
              decimals: 6,
              chainId: 8453,
            },
            {
              account: "0x1111111111111111111111111111111111111111",
              asset: "0x4444444444444444444444444444444444444444",
              amount: "100000",
              direction: "in",
              standard: "erc20",
              name: "USD Coin",
              symbol: "USDC",
              decimals: 6,
              chainId: 8453,
            },
          ],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.getByLabelText("−0.1 aBasUSDC")).toBeInTheDocument();
    expect(screen.getByLabelText("+0.1 USDC")).toBeInTheDocument();
    const effects = screen.getAllByTestId("asset-effect");
    expect(effects[0]).toHaveTextContent("Aave Base USDC");
    expect(effects[1]).toHaveTextContent("USD Coin");
    expect(
      effects.every((effect) =>
        Boolean(effect.querySelector('[data-asset-icon="coin"]')),
      ),
    ).toBe(true);
  });

  it("shows the full batch in the sidebar with inspectable request details", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        simulation: simulation(),
        transactions: [
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x01",
            label: "Approve USDC",
            kind: "approval",
            protocol: "LI.FI",
          },
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x3333333333333333333333333333333333333333",
            data: "0x02",
            label: "Swap USDC to ETH",
            kind: "swap",
            protocol: "LI.FI",
          },
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x4444444444444444444444444444444444444444",
            data: "0x03",
            label: "Send ETH",
            kind: "transfer",
          },
        ],
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.getAllByText("Approve USDC")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Swap USDC to ETH")[0]).toBeInTheDocument();
    const rows = screen.getAllByTestId("activity-transaction");
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.textContent?.includes("Approve USDC"))).toBe(
      true,
    );
    expect(
      rows.some((row) => row.textContent?.includes("Swap USDC to ETH")),
    ).toBe(true);
    expect(rows.some((row) => row.textContent?.includes("Send ETH"))).toBe(
      true,
    );
    expect(screen.getByText("Transaction details")).toBeInTheDocument();
    expect(screen.getByTestId("transaction-review")).toHaveTextContent("0x03");
  });

  it("turns protocol-generated swap labels into readable review steps", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        simulation: simulation(),
        transactions: [
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x01",
            label:
              "Approve LI.FI swap spender for exact 0.00758 USDC using quote lifi_q_abc123",
            kind: "erc20_approve",
            protocol: "lifi",
          },
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x3333333333333333333333333333333333333333",
            data: "0x02",
            label:
              "LI.FI same-chain swap quote lifi_q_abc123: 0.00758 USDC to ETH on chain 8453",
            kind: "lifi_swap",
            protocol: "lifi",
          },
        ],
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.getAllByText("Approve 0.00758 USDC")[0]).toBeInTheDocument();
    expect(screen.getAllByText(/LI\.FI/).length).toBeGreaterThan(0);
    expect(screen.getByText("Wallet changes unavailable")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("activity-transaction")[0],
    ).not.toHaveTextContent("lifi_q_abc123");
    expect(
      screen.getAllByText("Swap 0.00758 USDC to ETH")[0],
    ).toBeInTheDocument();
  });

  it("shows exact, unlimited, and revoked token permissions explicitly", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x01",
            label: "Update token permissions",
            kind: "approval",
          },
        ],
        simulation: {
          ...simulation(),
          approvals: [
            {
              account: "0x1111111111111111111111111111111111111111",
              spender: "0x2222222222222222222222222222222222222222",
              asset: "0x3333333333333333333333333333333333333333",
              kind: "allowance",
              amount: "7500",
              approved: true,
              unlimited: false,
              standard: "erc20",
              symbol: "USDC",
              decimals: 6,
              chainId: 8453,
            },
            {
              account: "0x1111111111111111111111111111111111111111",
              spender: "0x2222222222222222222222222222222222222222",
              asset: "0x4444444444444444444444444444444444444444",
              kind: "allowance",
              amount: "1000000000000000000000000000000000000000",
              approved: true,
              unlimited: true,
              standard: "erc20",
              symbol: "WETH",
              decimals: 18,
              chainId: 8453,
            },
            {
              account: "0x1111111111111111111111111111111111111111",
              spender: "0x2222222222222222222222222222222222222222",
              asset: "0x5555555555555555555555555555555555555555",
              kind: "allowance",
              amount: "0",
              approved: false,
              unlimited: false,
              standard: "erc20",
              symbol: "DAI",
              decimals: 18,
              chainId: 8453,
            },
          ],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.getByText("Allow 0.0075 USDC")).toBeInTheDocument();
    expect(screen.getByText("Unlimited WETH spending")).toBeInTheDocument();
    expect(screen.getAllByTestId("approval-effect")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Next wallet impact page" }),
    );
    expect(screen.getByText("Revoke DAI spending")).toBeInTheDocument();
    expect(screen.getAllByTestId("approval-effect")).toHaveLength(1);
  });

  it("describes NFT minting and collection-wide access", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 8453,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x01",
            label: "Mint collectible",
            kind: "mint",
          },
        ],
        simulation: {
          ...simulation(),
          balanceChanges: [
            {
              account: "0x1111111111111111111111111111111111111111",
              asset: "0x2222222222222222222222222222222222222222",
              amount: "1",
              direction: "in",
              standard: "erc721",
              name: "Aomi Founders",
              tokenId: "42",
              counterparty: "0x0000000000000000000000000000000000000000",
              chainId: 8453,
            },
            {
              account: "0x1111111111111111111111111111111111111111",
              asset: "0x3333333333333333333333333333333333333333",
              amount: "3",
              direction: "in",
              standard: "erc1155",
              name: "Aomi Pass",
              tokenId: "7",
              counterparty: "0x0000000000000000000000000000000000000000",
              chainId: 8453,
            },
          ],
          approvals: [
            {
              account: "0x1111111111111111111111111111111111111111",
              spender: "0x4444444444444444444444444444444444444444",
              asset: "0x3333333333333333333333333333333333333333",
              kind: "operator",
              approved: true,
              standard: "erc1155",
              name: "Aomi Pass",
              chainId: 8453,
            },
          ],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.getByText("NFT minted")).toBeInTheDocument();
    expect(screen.getByText("Aomi Founders #42")).toBeInTheDocument();
    expect(screen.getByText("Collectible minted")).toBeInTheDocument();
    expect(screen.getByText("+3 × Aomi Pass #7")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Next wallet impact page" }),
    );
    expect(
      screen.getByText("Allow access to all Aomi Pass"),
    ).toBeInTheDocument();
  });

  it("does not show a stale failure warning beside a passed verdict", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Transfer",
            kind: "transfer",
          },
        ],
        simulation: {
          ...simulation(),
          warnings: ["Simulation did not pass"],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(screen.queryByTestId("action-simulation")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Simulation did not pass"),
    ).not.toBeInTheDocument();
  });

  it("blocks approval when simulation failed", () => {
    runtime.pendingActions = [
      action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Transfer",
            kind: "transfer",
          },
        ],
        simulation: {
          ...simulation(),
          status: "failed",
          warnings: ["Execution reverted"],
        },
      }),
    ];

    render(<ActivitySidebar />);

    expect(
      screen.queryByRole("button", { name: "Send to wallet" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject request" }),
    ).toBeEnabled();
    expect(screen.getByText("Execution reverted")).toBeInTheDocument();
    expect(screen.getByText("Transaction details")).toBeInTheDocument();
    expect(screen.getByText("Simulation details")).toBeInTheDocument();
  });
});
