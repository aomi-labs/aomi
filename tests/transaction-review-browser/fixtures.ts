import type { Action, CommitView, Event } from "@aomi-labs/client";

export const signer = "0xda65d40000000000000000000000000000fc3cf0";

export const aaveReviewAction: Action = {
  type: "action",
  event_id: "event-aave-review",
  sequence: 4,
  turn_id: "turn-aave-review",
  occurred_at: 1_790_000_000_000,
  id: "action-aave-review",
  revision: 1,
  state: "pending",
  result: null,
  created_at: 1_790_000_000_000,
  expires_at: null,
  request: {
    type: "execute_evm",
    transactions: [
      {
        chain_id: 8453,
        from: signer,
        to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913",
        data: "0x095ea7b300000000000000000000000087870bca3f3fd6335c3f4ce8392d69350b4fa4e20000000000000000000000000000000000000000000000000000000005f5e100",
        value: "0",
        label: "Approve USDC for Aave",
        kind: "approval",
        protocol: "Aave",
      },
      {
        chain_id: 8453,
        from: signer,
        to: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        data: "0x617ba037000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000005f5e100000000000000000000000000da65d40000000000000000000000000000fc3cf00000000000000000000000000000000000000000000000000000000000000000",
        value: "0",
        label: "Supply 100 USDC to Aave",
        kind: "supply",
        protocol: "Aave",
      },
    ],
    simulation: {
      status: "passed",
      balanceChanges: [
        {
          account: signer,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913",
          amount: "100000000",
          direction: "out",
          standard: "erc20",
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
          chainId: 8453,
        },
        {
          account: signer,
          asset: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
          amount: "100000118",
          direction: "in",
          standard: "erc20",
          name: "Aave Base USDC",
          symbol: "aBasUSDC",
          decimals: 6,
          chainId: 8453,
        },
      ],
      approvals: [
        {
          owner: signer,
          spender: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913",
          amount: "100000000",
          kind: "erc20",
          symbol: "USDC",
          decimals: 6,
          chainId: 8453,
        },
      ],
      fees: [],
      gas: { units: "226611", priceWei: null, nativeCost: null },
      guards: [],
      logs: [],
      warnings: [],
    },
  },
};

export const aaveActivityEvents: Event[] = [
  {
    type: "message",
    event_id: "event-user-aave",
    sequence: 1,
    turn_id: "turn-aave-review",
    occurred_at: 1_790_000_000_000,
    sender: "user",
    content: "Deposit 100 USDC to Aave",
  },
  {
    type: "message",
    event_id: "event-skills-aave",
    sequence: 2,
    turn_id: "turn-aave-review",
    occurred_at: 1_790_000_000_001,
    sender: "agent",
    content: "",
    tool_result: [
      "activate_skill",
      JSON.stringify({ activated: ["aave", "common_erc20"] }),
    ],
  },
  aaveReviewAction,
];

const approve =
  aaveReviewAction.request.type === "execute_evm"
    ? aaveReviewAction.request.transactions[0]
    : undefined;
const supply =
  aaveReviewAction.request.type === "execute_evm"
    ? aaveReviewAction.request.transactions[1]
    : undefined;

if (!approve || !supply || aaveReviewAction.request.type !== "execute_evm") {
  throw new Error("Expected the two-leg EVM fixture");
}

export const durableActivityEvents: Event[] = [
  {
    type: "message",
    event_id: "event-user-aave",
    sequence: 1,
    turn_id: "turn-aave-review",
    occurred_at: 1_790_000_000_000,
    sender: "user",
    content: "Deposit 100 USDC to Aave",
  },
  {
    type: "message",
    event_id: "event-skills-aave",
    sequence: 2,
    turn_id: "turn-aave-review",
    occurred_at: 1_790_000_000_001,
    sender: "agent",
    content: "",
    tool_result: [
      "activate_skill",
      JSON.stringify({ activated: ["aave", "common_erc20"] }),
    ],
  },
  stagedTransactionEvent("approve", 3, 1, approve),
  stagedTransactionEvent("supply", 4, 2, supply),
];

function stagedTransactionEvent(
  id: string,
  sequence: number,
  sourceId: number,
  transaction: NonNullable<typeof approve>,
): Event {
  return {
    type: "message",
    event_id: `event-stage-${id}`,
    sequence,
    turn_id: "turn-aave-review",
    occurred_at: 1_790_000_000_000 + sequence,
    sender: "agent",
    content: "",
    tool_result: [
      "evm_stage_tx",
      JSON.stringify({
        ...transaction,
        pending_tx_id: sourceId,
        current_lifecycle: "queued",
      }),
    ],
  };
}

const reviewRequest = {
  ...aaveReviewAction.request,
  simulation: {
    ...aaveReviewAction.request.simulation,
    guards: [{ status: "passed", name: "aave-batch" }],
  },
};

const orderedStageIds = ["evm:1", "evm:2"];
const orderedCommitIds = ["commit-1", "commit-2"];

function commit(index: number, action: CommitView["action"]): CommitView {
  const stageId = orderedStageIds[index];
  return {
    version: 1,
    commit_id: orderedCommitIds[index],
    thread_id: "thread-1",
    stage_id: stageId,
    chain_family: "evm",
    chain_ref: "8453",
    signer,
    broadcaster: "wallet",
    state: "needs_signature",
    supported_transports: ["sign_and_broadcast", "browser_send"],
    transaction_id: null,
    failure_code: null,
    batch: {
      batch_id: "batch-1",
      index,
      ordered_stage_ids: orderedStageIds,
      ordered_commit_ids: orderedCommitIds,
      sources: [
        {
          thread_id: "thread-1",
          chain_family: "evm",
          chain_ref: "8453",
          stage_id: stageId,
          source_id: index + 1,
        },
      ],
      predecessor_commit_id: index === 0 ? null : orderedCommitIds[index - 1],
      review_digest: "review-1",
    },
    review: {
      version: 1,
      revision: 1,
      digest: "review-1",
      request: reviewRequest,
      legs: [approve, supply],
    },
    wallet_attempt: null,
    action,
  };
}

export const durableCommits: CommitView[] = [
  commit(0, {
    kind: "sign",
    payload: {
      kind: "evm_transaction",
      chain_id: 8453,
      signer,
      nonce: 7,
      transaction: {
        to: approve.to,
        value: approve.value ?? "0",
        data: approve.data,
        gas_limit: 58_000,
        max_fee_per_gas: "2000000000",
        max_priority_fee_per_gas: "1000000000",
      },
    },
  }),
  commit(1, null),
];

export const recoveryCommits: CommitView[] = durableCommits.map(
  (view, index) =>
    index === 0
      ? {
          ...view,
          version: 2,
          action: null,
          failure_code: "commit_wallet_transaction_mismatch",
          wallet_attempt: {
            attempt_id: "attempt-1",
            transport: "browser_send",
            state: "mismatched",
            transaction_id: "0xdeadbeef",
            failure_code: "commit_wallet_transaction_mismatch",
          },
        }
      : view,
);

export function failedReviewAction(): Action {
  if (aaveReviewAction.request.type !== "execute_evm") {
    throw new Error("Expected EVM review fixture");
  }
  return {
    ...aaveReviewAction,
    id: "action-aave-failed",
    event_id: "event-aave-failed",
    request: {
      ...aaveReviewAction.request,
      simulation: {
        ...aaveReviewAction.request.simulation,
        status: "failed",
        balanceChanges: [],
        approvals: [],
        warnings: ["Simulation reverted before the supply could execute."],
      },
    },
  };
}
