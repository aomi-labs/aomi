import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Action } from "@aomi-labs/client";
import { TransactionReview } from "./transaction-review";
import type { ApprovalChange, Simulation } from "./presentation";

const account = "0x1111111111111111111111111111111111111111";
const spender = "0x2222222222222222222222222222222222222222";
const asset = "0x3333333333333333333333333333333333333333";
const simulation = (): Simulation => ({
  status: "passed",
  balanceChanges: [],
  approvals: [],
  fees: [],
  gas: null,
  guards: [],
  logs: [],
  warnings: [],
});

function review(request: Action["request"]) {
  return render(
    <TransactionReview
      action={{
        type: "action",
        event_id: "event",
        sequence: 1,
        turn_id: "turn",
        occurred_at: 1,
        id: "action",
        revision: 1,
        state: "pending",
        request,
        result: null,
        created_at: 1,
        expires_at: null,
      }}
      onApprove={() => undefined}
      onReject={() => undefined}
    />,
  );
}

describe("sidebar wallet disclosures", () => {
  it.each([
    {
      kind: "allowance",
      standard: "erc20",
      amount: "42",
      decimals: 0,
      symbol: "TEST",
      expected: "Allow 42 TEST",
    },
    {
      kind: "token",
      standard: "erc721",
      tokenId: "7",
      symbol: "NFT",
      expected: "Approve NFT #7",
    },
  ] as const)(
    "preserves $kind permissions beside unrelated balance changes",
    (permission) => {
      const approval: ApprovalChange = {
        account,
        spender,
        asset,
        approved: true,
        unlimited: false,
        chainId: 1,
        ...permission,
      };
      review({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1,
            from: account,
            to: asset,
            data: "0x",
            kind: "approval",
            label: "Approve",
          },
          {
            chain_id: 1,
            from: account,
            to: spender,
            data: "0x",
            value: "1",
            kind: "transfer",
            label: "Transfer",
          },
        ],
        simulation: {
          ...simulation(),
          approvals: [approval],
          balanceChanges: [
            {
              account,
              asset: "native",
              amount: "1",
              direction: "out",
              symbol: "ETH",
              decimals: 18,
              chainId: 1,
            },
          ],
        },
      });
      expect(screen.getByTestId("approval-effect")).toHaveTextContent(
        permission.expected,
      );
      expect(screen.getByTestId("approval-effect")).toHaveTextContent(
        "To 0x222222…222222",
      );
    },
  );

  it("keeps additional permissions reachable through the existing pager", () => {
    review({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 1,
          from: account,
          to: asset,
          data: "0x",
          kind: "approval",
          label: "Approve",
        },
      ],
      simulation: {
        ...simulation(),
        approvals: [1, 2, 3].map((amount) => ({
          account,
          spender,
          asset,
          kind: "allowance",
          standard: "erc20",
          amount: String(amount),
          symbol: "TEST",
          decimals: 0,
          approved: true,
          unlimited: false,
        })),
      },
    });
    expect(screen.getAllByTestId("approval-effect")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Next wallet impact page" }),
    );
    expect(screen.getByTestId("approval-effect")).toHaveTextContent(
      "Allow 3 TEST",
    );
  });

  it("does not turn missing Solana effect decoding into a no-change assurance", () => {
    review({
      type: "execute_svm",
      transactions: [
        {
          payer: "SolanaSigner",
          cluster: "mainnet-beta",
          version: "legacy",
          instructions: [],
          description: "Transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    expect(screen.getByText("Wallet changes unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("Assets and permissions stay the same."),
    ).not.toBeInTheDocument();
  });

  it("retains the full signing request and every warning in the sole review layout", () => {
    const view = review({
      type: "sign",
      requestId: "sign",
      chainFamily: "evm",
      executionKind: "erc4337",
      signer: account,
      chainId: 1,
      description: "Sign",
      payloads: [{ kind: "evm_personal", message: "0x1234" }],
      calls: [{ to: spender, data: "0x5678", value: "9" }],
    });
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "0x1234",
    );
    expect(screen.getByTestId("transaction-review")).toHaveTextContent(
      "0x5678",
    );
    view.unmount();
    review({
      type: "execute_evm",
      transactions: [],
      simulation: {
        ...simulation(),
        warnings: ["First warning", "Second warning"],
      },
    });
    expect(screen.getByText("First warning")).toBeInTheDocument();
    expect(screen.getByText("Second warning")).toBeInTheDocument();
  });
});
