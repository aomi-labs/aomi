import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitController, CommitView } from "@aomi-labs/client";
import { runtime, simulation, walletKit } from "./test-fixtures";
import { ActivitySidebar } from "./activity-sidebar";

const ACTIVE = "0x1111111111111111111111111111111111111111";
const SIGNER = "0xcc83000000000000000000000000000000000f38";

const request = (count: number) => ({
  type: "execute_evm" as const,
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

function commits(count: number): CommitView[] {
  const req = request(count);
  const ids = Array.from(
    { length: count },
    (_, index) => `commit-${index + 1}`,
  );
  return ids.map((id, index) => ({
    version: 1,
    commit_id: id,
    thread_id: "thread-1",
    stage_id: `evm:${index + 1}`,
    chain_family: "evm",
    chain_ref: "8453",
    signer: SIGNER,
    broadcaster: "wallet",
    state: "needs_signature",
    supported_transports: ["sign_and_broadcast", "browser_send"],
    transaction_id: null,
    failure_code: null,
    batch:
      count > 1
        ? {
            batch_id: "batch-1",
            index,
            ordered_stage_ids: ids.map((_, i) => `evm:${i + 1}`),
            ordered_commit_ids: ids,
            sources: [],
            predecessor_commit_id: index ? ids[index - 1] : null,
            review_digest: "review-1",
          }
        : null,
    review: {
      version: 1,
      revision: 1,
      digest: "review-1",
      request: req,
      legs: [],
    },
    wallet_attempt: null,
    action: index
      ? null
      : {
          kind: "sign",
          payload: {
            kind: "evm_transaction",
            chain_id: 8453,
            signer: SIGNER,
            nonce: 1,
            transaction: {
              to: req.transactions[0].to,
              value: "0",
              data: "0x00",
              gas_limit: 50_000,
              max_fee_per_gas: "2",
              max_priority_fee_per_gas: "1",
            },
          },
        },
  })) as CommitView[];
}

/** The Privy wallet exists in the account, hydrated, but another wallet is active. */
const privyRow = (overrides: Record<string, unknown> = {}) => ({
  key: `evm:${SIGNER}`,
  family: "evm",
  address: SIGNER,
  kind: "embedded",
  provider: "privy",
  brand: "Privy",
  label: "My Privy",
  state: "offline",
  reason: "selection_required",
  connectionId: "privy#1",
  ...overrides,
});

function stage(count: number) {
  runtime.commits = commits(count);
  runtime.commitController = {
    review: (id: string) =>
      runtime.commits.find((view) => view.commit_id === id)?.review?.request,
    // Like the real controller: only the active wallet can start a send.
    canExecute: (view: CommitView) =>
      view.action != null && walletKit.identity.address === view.signer,
    execute: vi.fn(),
    reject: vi.fn(),
  } as unknown as CommitController;
}

describe("signer is not the active wallet", () => {
  beforeEach(() => {
    runtime.pendingActions = [];
    runtime.events = [];
    walletKit.identity = { address: ACTIVE };
    walletKit.wallets = [privyRow()];
    walletKit.activateWallet.mockReset().mockImplementation(async () => {
      walletKit.identity = { address: SIGNER };
      return "active";
    });
  });
  afterEach(cleanup);

  it("offers Switch to <wallet>, activates it, then plain Send", async () => {
    stage(1);
    const { rerender } = render(<ActivitySidebar />);
    expect(screen.queryByRole("button", { name: "Send transaction" })).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to My Privy" }),
      );
    });
    expect(walletKit.activateWallet).toHaveBeenCalledWith(`evm:${SIGNER}`);
    expect(runtime.commitController!.execute).not.toHaveBeenCalled();

    rerender(<ActivitySidebar />);
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Send transaction" })).toBeEnabled();
    expect(runtime.commitController!.execute).not.toHaveBeenCalled();
  });

  it("replaces a batch's send", async () => {
    stage(2);
    const { rerender } = render(<ActivitySidebar />);
    expect(
      screen.getByRole("button", { name: "Switch to My Privy" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to My Privy" }),
      );
    });
    rerender(<ActivitySidebar />);
    expect(
      screen.getByRole("button", { name: "Send 2 transactions" }),
    ).toBeEnabled();
  });

  it("says what to connect when the wallet is not available here", () => {
    walletKit.wallets = [
      privyRow({
        kind: "external",
        provider: undefined,
        brand: "Rabby",
        label: undefined,
        state: "offline",
        reason: "disconnected",
        connectionId: undefined,
      }),
    ];
    stage(1);
    render(<ActivitySidebar />);
    expect(screen.getByText("Connect Rabby to submit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send transaction" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    expect(walletKit.activateWallet).not.toHaveBeenCalled();
  });

  it("shows a failed switch under the review", async () => {
    walletKit.activateWallet.mockRejectedValue(new Error("Couldn’t switch."));
    stage(1);
    render(<ActivitySidebar />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to My Privy" }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t switch.",
    );
  });
});
