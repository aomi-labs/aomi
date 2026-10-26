import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CommitReview,
  CommitView,
  MessageReview,
} from "@aomi-labs/client";
import { TransactionReview } from "./transaction-review";
import { TransactionCard } from "./transactions";
import { selectActivity } from "./model";

const SIGNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const SPENDER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

const eligible = {
  decision: { eligibility: "eligible", reasonCode: "eligible" },
  authority: { eligibility: "eligible", reasonCode: "eligible" },
} as never;

function review(
  messageReview: MessageReview,
  description = "Allow USDC for Permit2",
): CommitReview {
  return {
    type: "sign",
    requestId: "evm-message:abc",
    chainFamily: "evm",
    executionKind: "evm_message",
    signer: SIGNER,
    chainId: 8453,
    description,
    payloads: [
      {
        kind: "evm_typed_data",
        typed_data: { primaryType: "Order", message: { sellToken: USDC } },
      },
    ],
    transactionSafety: eligible,
    messageReview,
  };
}

function show(request: CommitReview) {
  return render(
    <TransactionReview
      review={{ id: "cmt-message", revision: 1, request }}
      onApprove={vi.fn()}
      onReject={vi.fn()}
    />,
  );
}

const rows = () => screen.getAllByTestId("message-effect");

describe("message commit review", () => {
  it("shows a Permit2 allowance with its spender, limit and expiry", () => {
    show(
      review({
        kind: "permit2",
        rows: [
          {
            kind: "allowance",
            token: USDC,
            spender: SPENDER,
            amount: "500000000",
            unlimited: false,
            expires_at: 1_730_000_000,
          },
        ],
        tokens: { [USDC]: { symbol: "USDC", decimals: 6 } },
      }),
    );
    expect(screen.getByText("Permission changes")).toBeInTheDocument();
    const [row] = rows();
    expect(row).toHaveTextContent("≤ 500 USDC");
    expect(row).toHaveTextContent(/0x3fC91A…2b7FAD may spend · until /);
    expect(screen.getByText("Check passed")).toBeInTheDocument();
    expect(screen.queryByText("Signing request")).not.toBeInTheDocument();
    // The rows summarize; the exact signed message is always one tap away.
    expect(
      screen.getByText("Full message", { selector: "summary" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign message" })).toBeEnabled();
  });

  it("reads an unlimited allowance as Unlimited", () => {
    show(
      review({
        kind: "permit2",
        rows: [
          {
            kind: "allowance",
            token: USDC,
            spender: SPENDER,
            amount: "1461501637330902918203684832716283019655932542975",
            unlimited: true,
          },
        ],
        tokens: { [USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 } },
      }),
    );
    expect(rows()[0]).toHaveTextContent("Unlimited USDC");
    expect(rows()[0]).not.toHaveTextContent("until");
  });

  it("shows a CoW order's sell and minimum receive, raw for an unnamed token", () => {
    show(
      review(
        {
          kind: "cow_order",
          rows: [
            { kind: "sell", token: USDC, amount: "1000000" },
            {
              kind: "receive",
              token: WETH,
              amount: "250000000000000",
              minimum: true,
            },
          ],
          tokens: { [USDC]: { symbol: "USDC", decimals: 6 } },
        },
        "Sell 1 USDC on CoW",
      ),
    );
    expect(screen.getByText("Balance changes")).toBeInTheDocument();
    const [sell, receive] = rows();
    expect(sell).toHaveTextContent("You sell");
    expect(sell).toHaveTextContent("−1 USDC");
    expect(receive).toHaveTextContent("You receive at least");
    expect(receive).toHaveTextContent("+250000000000000 0x420000…000006");
  });

  it("shows a sign-in request's domain and statement", () => {
    show(
      review(
        {
          kind: "sign_in",
          rows: [
            {
              kind: "sign_in",
              domain: "hoodit.app",
              statement: "Sign in to Hoodit.",
            },
          ],
        },
        "Sign in to Hoodit",
      ),
    );
    const [row] = rows();
    expect(row).toHaveTextContent("Sign in to hoodit.app");
    expect(row).toHaveTextContent("Sign in to Hoodit.");
  });

  it("warns about a message Aomi can't read and shows what is signed", () => {
    show(
      review({
        kind: "generic",
        rows: [],
        warning:
          "Aomi can't read what this signature allows. Check it carefully.",
      }),
    );
    expect(
      screen.getByText(
        "Aomi can't read what this signature allows. Check it carefully.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("message-effect")).toHaveLength(0);
    expect(
      screen.getByText("Full message", { selector: "summary" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Signing request")).not.toBeInTheDocument();
  });
});

describe("message commit card", () => {
  const commit: CommitView = {
    version: 2,
    commit_id: "cmt-message",
    thread_id: "thread-1",
    stage_id: "evm-message:abc",
    chain_family: "evm",
    chain_ref: "8453",
    signer: SIGNER,
    broadcaster: "wallet",
    state: "confirmed",
    transaction_id: null,
    signature: "0xsigned",
    failure_code: null,
    batch: null,
    review: {
      version: 2,
      revision: 1,
      digest: "digest",
      request: review({ kind: "generic", rows: [] }) as never,
      legs: [],
    },
    wallet_attempt: null,
    action: null,
  };

  it("projects the commit as a Stage · Check · Commit · Signed card titled by its description", () => {
    const { transactions, history } = selectActivity([], [], [commit]);
    expect([...transactions, ...history]).toHaveLength(1);
    const tx = transactions[0]!;
    expect(tx).toMatchObject({
      kind: "message",
      label: "Allow USDC for Permit2",
    });
    // The commit's chain is the wallet's; this message names none, so no label.
    expect(tx.chainId).toBeUndefined();
    render(<TransactionCard transaction={tx} executing={false} current />);
    const card = screen.getByTestId("activity-transaction");
    expect(
      within(card).getByText("Allow USDC for Permit2"),
    ).toBeInTheDocument();
    for (const phase of ["Stage", "Check", "Commit", "Signed"])
      expect(within(card).getByText(phase)).toBeInTheDocument();
    expect(within(card).queryByText("Simulate")).not.toBeInTheDocument();
    expect(within(card).getByTitle("Signed")).toBeInTheDocument();
  });

  it("labels the network only when the EIP-712 domain names it", () => {
    const typed = {
      ...commit,
      review: {
        ...commit.review!,
        request: {
          ...review({ kind: "generic", rows: [] }),
          payloads: [
            {
              kind: "evm_typed_data",
              typed_data: { domain: { chainId: 8453 }, message: {} },
            },
          ],
        } as never,
      },
    };
    const [tx] = selectActivity([], [], [typed]).transactions;
    expect(tx.chainId).toBe(8453);
    render(<TransactionCard transaction={tx!} executing={false} current />);
    expect(screen.getByTitle("Base")).toBeInTheDocument();
  });

  it("omits the network label when none is known", () => {
    const [tx] = selectActivity([], [], [commit]).transactions;
    render(<TransactionCard transaction={tx!} executing={false} current />);
    const card = screen.getByTestId("activity-transaction");
    expect(card).not.toHaveTextContent(/Ethereum|Base|Solana|Chain/);
  });
});
