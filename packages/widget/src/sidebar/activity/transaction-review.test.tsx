import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionRequest } from "@aomi-labs/client";
import { TransactionReview } from "./transaction-review";
import { simulation } from "./test-fixtures";

const SIGNER = "0x1111111111111111111111111111111111111111";
const transactions = (count: number): ActionRequest => ({
  type: "execute_evm",
  transactions: Array.from({ length: count }, (_, index) => ({
    chain_id: 8453,
    from: SIGNER,
    to: "0x2222222222222222222222222222222222222222",
    data: `0x0${index}`,
    label: `Swap ${index + 1}`,
    kind: "swap",
  })),
  simulation: simulation(),
});
const message: ActionRequest = {
  type: "sign",
  requestId: "evm-message:abc",
  chainFamily: "evm",
  executionKind: "evm_message",
  signer: SIGNER,
  chainId: 8453,
  description: "Sign in to Hoodit",
  payloads: [{ kind: "evm_personal", message: "Sign in to Hoodit." }],
};

function show(
  request: ActionRequest,
  props: Partial<Parameters<typeof TransactionReview>[0]> = {},
) {
  return render(
    <TransactionReview
      review={{ id: "review", revision: 1, request }}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      {...props}
    />,
  );
}

describe("TransactionReview labels", () => {
  afterEach(cleanup);

  it("names what the group does, singular and plural", () => {
    show(transactions(1));
    expect(
      screen.getByRole("button", { name: "Send transaction" }),
    ).toBeEnabled();
    cleanup();
    show(transactions(3));
    expect(
      screen.getByRole("button", { name: "Send 3 transactions" }),
    ).toBeEnabled();
    cleanup();
    show(message, { approving: true });
    expect(screen.getByRole("button", { name: "Signing…" })).toBeDisabled();
  });

  it("says the wallet asks several times only when it really does", () => {
    show(transactions(2), { prompts: 2 });
    expect(
      screen.getByText("· 2 signatures, in order", { exact: false }),
    ).toBeInTheDocument();
    cleanup();
    show(transactions(2), { prompts: 1 });
    expect(screen.queryByText(/signatures, in order/)).toBeNull();
  });

  it("splits off Submit all only while idle", () => {
    const queued = {
      onApproveAll: vi.fn(),
      batchProgress: { current: 1, total: 2 },
    };
    const { rerender } = show(transactions(2), queued);
    expect(
      screen.getByRole("button", { name: "Send 2 transactions · 1 of 2" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Submit all" })).toBeEnabled();

    rerender(
      <TransactionReview
        review={{ id: "review", revision: 1, request: transactions(2) }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        submitting
        {...queued}
      />,
    );
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit all" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Working/ })).toBeNull();
  });

  it("limited_coverage_reason_shown_beside_approve", () => {
    const request = transactions(1);
    show({
      ...request,
      transactionSafety: {
        assessment: {
          version: 1,
          candidateDigest: "candidate",
          assessmentDigest: "assessment",
          registryVersion: "1",
          state: "complete",
          coverage: "generic",
          supportedOperationCount: 0,
          totalOperationCount: 1,
          checks: [],
          findings: [],
          limitations: [
            {
              code: "unsupported_operation",
              operationIds: ["0"],
              message:
                "This deployment and operation has no supported guard profile",
            },
          ],
        },
        decision: {
          mode: "balanced",
          policyRevision: 1,
          assessmentDigest: "assessment",
          eligibility: "eligible",
          reasonCode: "simulation_passed",
          bypassedFindingIds: [],
          bypassedRequirements: [],
        },
        authority: { eligibility: "eligible", reasonCode: "authority_valid" },
        simulationStatus: "passed",
      },
    });
    expect(screen.getByText("Simulation passed")).toBeInTheDocument();
    // Simulation and coverage share one line; the reason opens on a click.
    const checks = screen.getByRole("button", {
      name: /Simulation passed.*Limited coverage/,
    });
    expect(checks).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText(
        "This deployment and operation has no supported guard profile",
      ),
    ).not.toBeVisible();
    fireEvent.click(checks);
    expect(
      screen.getByText(
        "This deployment and operation has no supported guard profile",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Send transaction" }),
    ).toBeEnabled();
    cleanup();
    show(request);
    expect(screen.queryByText(/Limited coverage/)).toBeNull();
  });
});
