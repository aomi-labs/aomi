import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommitController,
  type CommitView,
  type Event,
} from "@aomi-labs/client";
import { action, runtime, simulation } from "./test-fixtures";
import { ActivitySidebar } from "./activity-sidebar";
import { WalletReview } from "./wallet-review";

describe("WalletReview", () => {
  beforeEach(() => {
    runtime.isRunning = false;
    runtime.pendingActions = [];
    runtime.events = [];
    runtime.commits = [];
    runtime.commitController = undefined;
    runtime.turnState = undefined;
    runtime.executeAction.mockReset().mockResolvedValue(undefined);
    runtime.rejectAction.mockReset().mockResolvedValue(undefined);
    runtime.showNotification.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders one whole-operation review from durable commits", async () => {
    const request = {
      type: "execute_evm" as const,
      transactions: [
        {
          chain_id: 8453,
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          data: "0x01",
          label: "Approve USDC for Aave",
          kind: "approval",
        },
        {
          chain_id: 8453,
          from: "0x1111111111111111111111111111111111111111",
          to: "0x3333333333333333333333333333333333333333",
          data: "0x02",
          label: "Supply 100 USDC to Aave",
          kind: "supply",
        },
      ],
      simulation: {
        ...simulation(),
        balanceChanges: [
          {
            account: "0x1111111111111111111111111111111111111111",
            asset: "0x4444444444444444444444444444444444444444",
            amount: "100000000",
            direction: "out" as const,
            standard: "erc20" as const,
            name: "USD Coin",
            symbol: "USDC",
            decimals: 6,
            chainId: 8453,
          },
          {
            account: "0x1111111111111111111111111111111111111111",
            asset: "0x5555555555555555555555555555555555555555",
            amount: "100000118",
            direction: "in" as const,
            standard: "erc20" as const,
            name: "Aave Base USDC",
            symbol: "aBasUSDC",
            decimals: 6,
            chainId: 8453,
          },
        ],
      },
    };
    const commit = (sourceId: number, index: number): CommitView => ({
      version: 1,
      commit_id: `commit-${sourceId}`,
      thread_id: "thread-1",
      stage_id: `evm:${sourceId}`,
      chain_family: "evm",
      chain_ref: "8453",
      signer: "0x1111111111111111111111111111111111111111",
      broadcaster: "wallet",
      state: "needs_signature",
      supported_transports: ["sign_and_broadcast", "browser_send"],
      transaction_id: null,
      failure_code: null,
      batch: {
        batch_id: "batch-1",
        index,
        ordered_stage_ids: ["evm:1", "evm:2"],
        ordered_commit_ids: ["commit-1", "commit-2"],
        sources: [
          {
            thread_id: "thread-1",
            chain_family: "evm",
            chain_ref: "8453",
            stage_id: `evm:${sourceId}`,
            source_id: sourceId,
          },
        ],
        predecessor_commit_id: index ? "commit-1" : null,
        review_digest: "review-1",
      },
      review: {
        version: 1,
        revision: 1,
        digest: "review-1",
        request,
        legs: [],
      },
      wallet_attempt: null,
      action:
        index === 0
          ? {
              kind: "sign",
              payload: {
                kind: "evm_transaction",
                chain_id: 8453,
                signer: "0x1111111111111111111111111111111111111111",
                nonce: 7,
                transaction: {
                  to: request.transactions[0].to,
                  value: "0",
                  data: request.transactions[0].data,
                  gas_limit: 50_000,
                  max_fee_per_gas: "2",
                  max_priority_fee_per_gas: "1",
                },
              },
            }
          : null,
    });
    runtime.events = [1, 2].map(
      (sourceId) =>
        ({
          type: "message",
          event_id: `event-${sourceId}`,
          sequence: sourceId,
          turn_id: "turn-1",
          occurred_at: sourceId,
          sender: "agent",
          content: "",
          tool_name: "evm_stage_tx",
          tool_result: [
            "evm_stage_tx",
            JSON.stringify({
              ...request.transactions[sourceId - 1],
              pending_tx_id: sourceId,
              current_lifecycle: "queued",
            }),
          ],
        }) satisfies Event,
    );
    runtime.commits = [commit(1, 0), commit(2, 1)];
    runtime.pendingActions = [action(request)];
    const execute = vi.fn().mockResolvedValue(undefined);
    runtime.commitController = {
      review: (id: string) =>
        runtime.commits.find((candidate) => candidate.commit_id === id)?.review
          ?.request,
      canExecute: (view: CommitView) => view.action != null,
      execute,
      reject: vi.fn(),
    } as unknown as CommitController;

    const { rerender } = render(<ActivitySidebar />);

    expect(screen.getAllByTestId("activity-transaction")).toHaveLength(2);
    expect(screen.getAllByTestId("asset-effect")[0]).toHaveTextContent("−100");
    expect(screen.getAllByTestId("asset-effect")[1]).toHaveTextContent(
      "+100.000118",
    );
    expect(screen.getAllByTestId("transaction-review")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Submit 1 of 2" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith("commit-1"));
    expect(runtime.executeAction).not.toHaveBeenCalled();

    runtime.commits = [
      {
        ...runtime.commits[0],
        action: null,
        wallet_attempt: {
          attempt_id: "attempt-1",
          transport: "browser_send",
          state: "reported",
          transaction_id: "0xdeadbeef",
          failure_code: null,
        },
      },
      runtime.commits[1],
    ];
    rerender(<ActivitySidebar />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wallet submitted the transaction. Checking on-chain confirmation…",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Transaction: 0xdeadbeef",
    );

    runtime.commits = runtime.commits.map((view) => ({
      ...view,
      state: "expired",
      action: null,
    }));
    rerender(<ActivitySidebar />);

    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();

    runtime.pendingActions = [
      action(request),
      {
        ...action(request),
        id: "action-2",
        sequence: 2,
      },
    ];
    rerender(<ActivitySidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(runtime.executeAction).toHaveBeenCalledWith("action-2"),
    );

    cleanup();
    runtime.pendingActions = [action(request)];
    runtime.commits = [
      {
        ...runtime.commits[0],
        state: "needs_signature",
        action: null,
        wallet_attempt: {
          attempt_id: "attempt-1",
          transport: "browser_send",
          state: "mismatched",
          transaction_id: "0xdeadbeef",
          failure_code: "transaction_mismatch",
        },
      },
      { ...runtime.commits[1], state: "needs_signature" },
    ];
    render(<ActivitySidebar />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The submitted transaction did not match the reviewed request.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Transaction: 0xdeadbeef",
    );
  });

  it("retries a saved wallet outcome without sending the transaction twice", async () => {
    const request = {
      type: "execute_evm" as const,
      transactions: [
        {
          chain_id: 8453,
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          data: "0x01",
          label: "Supply USDC",
          kind: "supply",
        },
      ],
      simulation: simulation(),
    };
    const initial: CommitView = {
      version: 1,
      commit_id: "commit-recovery",
      thread_id: "thread-1",
      stage_id: "evm:1",
      chain_family: "evm",
      chain_ref: "8453",
      signer: request.transactions[0].from,
      broadcaster: "wallet",
      state: "needs_signature",
      supported_transports: ["sign_and_broadcast", "browser_send"],
      transaction_id: null,
      failure_code: null,
      batch: null,
      review: {
        version: 1,
        revision: 1,
        digest: "review-1",
        request,
        legs: [],
      },
      wallet_attempt: null,
      action: {
        kind: "sign",
        payload: {
          kind: "evm_transaction",
          chain_id: 8453,
          signer: request.transactions[0].from,
          nonce: 7,
          transaction: {
            to: request.transactions[0].to,
            value: "0",
            data: request.transactions[0].data,
            gas_limit: 50_000,
            max_fee_per_gas: "2",
            max_priority_fee_per_gas: "1",
          },
        },
      },
    };
    const walletAttempt = {
      attempt_id: "attempt-1",
      transport: "browser_send" as const,
      state: "awaiting_wallet" as const,
      transaction_id: null,
      failure_code: null,
    };
    const awaiting: CommitView = {
      ...initial,
      version: 2,
      action: null,
      wallet_attempt: walletAttempt,
    };
    const submitted: CommitView = {
      ...awaiting,
      version: 3,
      state: "submitted",
      transaction_id: "0xtransaction",
      wallet_attempt: {
        ...walletAttempt,
        state: "reported",
        transaction_id: "0xtransaction",
      },
    };
    const saved = new Map<
      string,
      {
        clientRequestId: string;
        attemptId?: string;
        transactionId?: string;
      }
    >();
    const recovery = {
      load: (_threadId: string, commitId: string) => saved.get(commitId),
      save: (
        _threadId: string,
        commitId: string,
        record: {
          clientRequestId: string;
          attemptId?: string;
          transactionId?: string;
        },
      ) => saved.set(commitId, record),
      remove: (_threadId: string, commitId: string) => saved.delete(commitId),
    };
    let reports = 0;
    const requestApi = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return initial;
      if (path.endsWith("/wallet-attempts"))
        return {
          attempt_id: "attempt-1",
          transport: "browser_send",
          commit_id: initial.commit_id,
          state: "awaiting_wallet",
          request:
            initial.action?.kind === "sign" ? initial.action.payload : null,
          may_invoke_wallet: true,
        };
      reports += 1;
      if (reports === 1) throw new Error("report transport failed");
      return submitted;
    });
    const walletSend = vi.fn().mockResolvedValue("0xtransaction");
    const controller = new CommitController(
      { request: requestApi } as never,
      initial.thread_id,
      { recovery, walletSend, walletSendPreflight: vi.fn() },
    );
    controller.ingest(initial);
    runtime.commitController = controller;
    runtime.commits = [initial];

    const view = render(<ActivitySidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(runtime.showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: "report transport failed" }),
      ),
    );

    runtime.commits = [awaiting];
    controller.ingest(awaiting);
    view.rerender(<ActivitySidebar />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wallet transaction found. Continue to verify it.",
    );
    const retry = screen.getByRole("button", { name: "Submit" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => expect(reports).toBe(2));
    expect(walletSend).toHaveBeenCalledTimes(1);
    controller.close();

    saved.set(initial.commit_id, {
      clientRequestId: "request-1",
      attemptId: "attempt-1",
      transactionId: "0xtransaction",
    });
    const mismatched: CommitView = {
      ...awaiting,
      version: 4,
      wallet_attempt: {
        ...walletAttempt,
        state: "mismatched",
        transaction_id: "0xtransaction",
        failure_code: "commit_wallet_transaction_nonce_mismatch",
      },
    };
    const mismatchController = new CommitController(
      { request: requestApi } as never,
      initial.thread_id,
      { recovery, walletSend, walletSendPreflight: vi.fn() },
    );
    mismatchController.ingest(mismatched);
    runtime.commitController = mismatchController;
    runtime.commits = [mismatched];
    view.rerender(<ActivitySidebar />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The wallet used a different nonce from the prepared transaction.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Transaction: 0xtransaction",
    );
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    await mismatchController.execute(mismatched.commit_id);
    expect(reports).toBe(2);
    expect(walletSend).toHaveBeenCalledTimes(1);
    mismatchController.close();
  });

  it("renders and approves a reviewless durable Solana commit", async () => {
    const commit: CommitView = {
      version: 1,
      commit_id: "commit-svm",
      thread_id: "thread-1",
      stage_id: "svm:7",
      chain_family: "svm",
      chain_ref: "devnet",
      signer: "payer-address",
      broadcaster: "wallet",
      state: "needs_signature",
      transaction_id: null,
      failure_code: null,
      batch: null,
      review: null,
      wallet_attempt: null,
      action: {
        kind: "sign",
        payload: {
          kind: "svm_transaction",
          signer: "payer-address",
          transaction_base64: "AQID",
        },
      },
    };
    const submitted: CommitView = {
      ...commit,
      version: 2,
      state: "submitted",
      action: null,
      transaction_id: "solana-signature",
    };
    const request = vi.fn(async (method: string) =>
      method === "GET" ? commit : submitted,
    );
    const sign = vi.fn().mockResolvedValue(["signed-transaction"]);
    const controller = new CommitController(
      { request } as never,
      commit.thread_id,
      { sign },
    );
    controller.ingest(commit);
    runtime.commitController = controller;
    runtime.commits = [commit];

    render(<ActivitySidebar />);

    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "Review Solana transaction",
    );
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "devnet",
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const signAction = commit.action;
    if (signAction?.kind !== "sign") throw new Error("expected sign action");
    await waitFor(() =>
      expect(sign).toHaveBeenCalledWith(commit, signAction.payload),
    );
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/commits/commit-svm/manual",
      expect.objectContaining({
        body: { kind: "signed", payloads: ["signed-transaction"] },
      }),
    );
    controller.close();
  });

  it("resumes a reviewless Solana commit awaiting broadcast", async () => {
    const commit: CommitView = {
      version: 2,
      commit_id: "commit-svm-broadcast",
      thread_id: "thread-1",
      stage_id: "svm:8",
      chain_family: "svm",
      chain_ref: "devnet",
      signer: "payer-address",
      broadcaster: "wallet",
      state: "awaiting_broadcast",
      transaction_id: null,
      failure_code: null,
      batch: null,
      review: null,
      wallet_attempt: null,
      action: {
        kind: "broadcast",
        signed_transaction: "signed-transaction",
        transaction_id: "solana-signature",
      },
    };
    const submitted: CommitView = {
      ...commit,
      version: 3,
      state: "submitted",
      action: null,
      transaction_id: "solana-signature",
    };
    const request = vi.fn(async (method: string) =>
      method === "GET" ? commit : submitted,
    );
    const walletBroadcast = vi.fn().mockResolvedValue("solana-signature");
    const controller = new CommitController(
      { request } as never,
      commit.thread_id,
      { walletBroadcast },
    );
    controller.ingest(commit);
    runtime.commitController = controller;
    runtime.commits = [commit];

    render(<ActivitySidebar />);

    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "Submit signed Solana transaction",
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(walletBroadcast).toHaveBeenCalledWith(
        commit,
        "signed-transaction",
      ),
    );
    controller.close();
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
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

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
    expect(screen.queryByText("Simulate")).not.toBeInTheDocument();
    for (const label of ["Stage", "Commit", "Signed"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("hosted")).toBeInTheDocument();
    expect(screen.getByText("Sponsorship required")).toBeInTheDocument();
    expect(screen.getByText("123456 native base units")).toBeInTheDocument();
    expect(screen.getByText("Application fee")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

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
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject request" }),
    ).toBeEnabled();
    expect(screen.getByText("Execution reverted")).toBeInTheDocument();
    expect(screen.getByText("Transaction details")).toBeInTheDocument();
    expect(screen.getByText("Simulation details")).toBeInTheDocument();
  });
});

describe("ordered batch submission", () => {
  const request = {
    type: "execute_evm" as const,
    transactions: [1, 2].map((index) => ({
      chain_id: 8453,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: `0x0${index}`,
      label: `Transaction ${index}`,
      kind: "transfer",
    })),
    simulation: simulation(),
  };
  const commit = (
    index: number,
    state: CommitView["state"] = "needs_signature",
  ): CommitView => ({
    version: 1,
    commit_id: `commit-${index + 1}`,
    thread_id: "thread-1",
    stage_id: `evm:${index + 1}`,
    chain_family: "evm",
    chain_ref: "8453",
    signer: request.transactions[index].from,
    broadcaster: "wallet",
    state,
    supported_transports: ["sign_and_broadcast"],
    transaction_id: null,
    failure_code: null,
    batch: {
      batch_id: "batch-1",
      index,
      ordered_stage_ids: ["evm:1", "evm:2"],
      ordered_commit_ids: ["commit-1", "commit-2"],
      sources: [],
      predecessor_commit_id: index ? "commit-1" : null,
      review_digest: "digest-1",
    },
    review: {
      version: 1,
      revision: 1,
      digest: "digest-1",
      request,
      legs: [],
    },
    wallet_attempt: null,
    action: {
      kind: "sign",
      payload: {
        kind: "evm_transaction",
        chain_id: 8453,
        signer: request.transactions[index].from,
        nonce: index + 1,
        transaction: {
          to: request.transactions[index].to,
          value: "0",
          data: request.transactions[index].data,
          gas_limit: 50_000,
          max_fee_per_gas: "2",
          max_priority_fee_per_gas: "1",
        },
      },
    },
  });

  beforeEach(() => {
    runtime.pendingActions = [];
    runtime.events = [];
    runtime.commits = [commit(0), commit(1)];
    runtime.showNotification.mockReset();
  });
  afterEach(cleanup);

  function controller(execute: ReturnType<typeof vi.fn>) {
    runtime.commitController = {
      threadId: "thread-1",
      review: () => request,
      canExecute: (view: CommitView) => view.action != null,
      execute,
      reject: vi.fn(),
    } as unknown as CommitController;
  }

  it("submits each reviewed leg once, after its predecessor confirms", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve(runtime.commits.find((view) => view.commit_id === id)!),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    expect(screen.getByRole("button", { name: "Submit 1 of 2" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith("commit-1"));
    expect(execute).toHaveBeenCalledTimes(1);

    runtime.commits = [
      { ...runtime.commits[0], state: "submitted" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Submit 2 of 2" }),
    ).toBeDisabled();

    runtime.commits = [
      { ...runtime.commits[0], state: "confirmed" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    await waitFor(() => expect(execute).toHaveBeenNthCalledWith(2, "commit-2"));
    expect(execute).toHaveBeenCalledTimes(2);

    runtime.commits = [
      runtime.commits[0],
      { ...runtime.commits[1], state: "confirmed" },
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("keeps Submit next scoped to one transaction", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve(runtime.commits.find((view) => view.commit_id === id)!),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit 1 of 2" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith("commit-1"));

    runtime.commits = [
      { ...runtime.commits[0], state: "submitted" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    expect(
      screen.getByRole("button", { name: "Submit 2 of 2" }),
    ).toBeInTheDocument();

    runtime.commits = [
      { ...runtime.commits[0], state: "confirmed" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Submit 2 of 2" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Submit all" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit 2 of 2" }));
    await waitFor(() => expect(execute).toHaveBeenNthCalledWith(2, "commit-2"));
  });

  it("stops the batch after a wallet mismatch", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve(runtime.commits.find((view) => view.commit_id === id)!),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    runtime.commits = [
      { ...runtime.commits[0], state: "submitted" },
      {
        ...runtime.commits[1],
        wallet_attempt: {
          attempt_id: "attempt-2",
          transport: "browser_send",
          state: "mismatched",
          transaction_id: "0xdeadbeef",
          failure_code: "transaction_mismatch",
        },
      },
    ];
    rerender(<WalletReview />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit 2 of 2" }),
      ).toBeEnabled(),
    );
    runtime.commits = [
      { ...runtime.commits[0], state: "confirmed" },
      {
        ...runtime.commits[1],
        wallet_attempt: null,
      },
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stops after the wallet rejects a commit", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve({
        ...runtime.commits.find((view) => view.commit_id === id)!,
        state: "rejected" as const,
      }),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit all" })).toBeEnabled(),
    );

    runtime.commits = [
      { ...runtime.commits[0], state: "confirmed" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not resume after switching away from and back to the controller", async () => {
    let finishFirst: (view: CommitView) => void = () => undefined;
    const execute = vi.fn(
      () =>
        new Promise<CommitView>((resolve) => {
          finishFirst = resolve;
        }),
    );
    controller(execute);
    const original = runtime.commitController;
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    controller(vi.fn());
    rerender(<WalletReview />);
    runtime.commitController = original;
    rerender(<WalletReview />);
    await act(async () => finishFirst(runtime.commits[0]));
    runtime.commits = [
      { ...runtime.commits[0], state: "confirmed" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit 2 of 2" }),
      ).toBeEnabled(),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("requires fresh batch consent after the review closes", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve(runtime.commits.find((view) => view.commit_id === id)!),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    const remaining = runtime.commits[1];
    runtime.commits = [];
    rerender(<WalletReview />);
    await waitFor(() =>
      expect(screen.queryByTestId("transaction-review")).toBeNull(),
    );

    runtime.commits = [commit(0, "confirmed"), remaining];
    rerender(<WalletReview />);
    expect(screen.getByRole("button", { name: "Submit 2 of 2" })).toBeEnabled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("cancels when another batch becomes the visible review", async () => {
    const execute = vi.fn((id: string) =>
      Promise.resolve(runtime.commits.find((view) => view.commit_id === id)!),
    );
    controller(execute);
    const { rerender } = render(<WalletReview />);
    fireEvent.click(screen.getByRole("button", { name: "Submit all" }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    const unrelated: CommitView = {
      ...commit(0),
      commit_id: "other-commit",
      batch: {
        ...commit(0).batch!,
        batch_id: "other-batch",
        ordered_commit_ids: ["other-commit"],
      },
    };
    runtime.commits = [
      unrelated,
      { ...runtime.commits[0], state: "submitted" },
      runtime.commits[1],
    ];
    rerender(<WalletReview />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled(),
    );

    runtime.commits = [
      { ...runtime.commits[1], state: "confirmed" },
      runtime.commits[2],
    ];
    rerender(<WalletReview />);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
