import { describe, expect, it } from "vitest";
import type { Action, Event } from "@aomi-labs/client";
import { selectActivity } from "./model";

const tx = {
  chain_id: 8453,
  from: "0x123",
  to: "0x456",
  data: "0xabcdef",
  value: "0",
  label: "Swap USDT to USDC",
  kind: "swap",
};
const meta = (sequence: number, turn_id = "turn-1") => ({
  sequence,
  turn_id,
  event_id: `e-${sequence}`,
  occurred_at: sequence,
});
const tool = (
  sequence: number,
  tool_name: string,
  result: unknown,
  turn = "turn-1",
): Event => ({
  ...meta(sequence, turn),
  type: "message",
  sender: "agent",
  content: "",
  tool_name,
  tool_result: [tool_name, JSON.stringify(result)],
});
const action = (sequence: number, patch: Partial<Action> = {}): Action => ({
  ...meta(sequence),
  type: "action",
  id: "a1",
  revision: 1,
  state: "pending",
  created_at: sequence,
  expires_at: null,
  request: {
    type: "execute_evm",
    transactions: [tx],
    simulation: {
      status: "passed",
      balanceChanges: [],
      approvals: [],
      fees: [],
      guards: [],
      logs: [],
      warnings: [],
      gas: null,
    },
  },
  ...patch,
});
const stage = tool(1, "evm_stage_tx", {
  ...tx,
  pending_tx_id: 1,
  current_lifecycle: "queued",
});

describe("activity projection", () => {
  it("tracks stage, simulation and commit without fabricating an Action", () => {
    expect(selectActivity([stage]).transactions[0].stage).toBe("staged");
    const sim = tool(2, "evm_simulate_batch", {
      resolved_ids: [1],
      simulation: { batch_success: true },
    });
    expect(selectActivity([stage, sim]).transactions[0].stage).toBe(
      "simulated",
    );
    const commit = tool(3, "evm_commit_txs", {
      tx_ids: [1],
      status: "pending_approval",
    });
    const state = selectActivity([stage, sim, commit]);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].stage).toBe("committed");
    expect(state.transactions[0].action).toBeUndefined();
  });
  it("reconciles an Action by exact payload and preserves latest rejection on replay", () => {
    const state = selectActivity([
      action(4, { state: "rejected", revision: 2 }),
      stage,
      action(2),
    ]);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].action?.state).toBe("rejected");
  });
  it("does not combine different payloads with the same name", () => {
    const other = action(2);
    if (other.request.type === "execute_evm")
      other.request.transactions = [{ ...tx, to: "0x999" }];
    expect(selectActivity([stage, other]).transactions).toHaveLength(2);
  });
  it("handles repeated identical transactions one-to-one", () => {
    const batch = action(3);
    if (batch.request.type === "execute_evm")
      batch.request.transactions = [tx, tx];
    const stage2 = tool(2, "evm_stage_tx", {
      ...tx,
      pending_tx_id: 2,
      current_lifecycle: "queued",
    });
    expect(selectActivity([stage, stage2, batch]).transactions).toHaveLength(2);
  });
  it("keeps failed simulation scoped to the affected IDs and allows a successful retry", () => {
    const failed = tool(2, "evm_simulate_batch", {
      resolved_ids: [1],
      simulation: { batch_success: false },
    });
    expect(selectActivity([stage, failed]).transactions[0].stage).toBe(
      "simulation-failed",
    );
    expect(
      selectActivity([
        stage,
        failed,
        tool(3, "evm_simulate_batch", {
          resolved_ids: [1],
          simulation: { batch_success: true },
        }),
      ]).transactions[0].stage,
    ).toBe("simulated");
  });
  it("starts a new turn cleanly but retains an unresolved wallet request", () => {
    const user: Event = {
      ...meta(3, "turn-2"),
      type: "message",
      sender: "user",
      content: "Next request",
    };
    const state = selectActivity([stage, action(2), user, action(4)]);
    expect(state.turnId).toBe("turn-2");
    expect(state.transactions).toHaveLength(1);
    expect(selectActivity([stage, user]).transactions).toHaveLength(0);
    expect(selectActivity([]).transactions).toHaveLength(0);
  });
  it("deduplicates successful skill activation and excludes failed activations", () => {
    const activated = tool(1, "activate_skill", {
      activated: ["common_erc20", "lifi_swap"],
    });
    expect(
      selectActivity([
        activated,
        activated,
        tool(2, "activate_skill", { error: "failed", activated: ["other"] }),
      ]).skills,
    ).toEqual(["common_erc20", "lifi_swap"]);
  });
  it("never promotes truncated child tool previews to wallet transactions", () => {
    const event: Event = {
      ...meta(1),
      type: "task_activity",
      call_id: "call-1",
      agent_id: "child",
      child_seq: 1,
      kind: "tool_call",
      tool_name: "evm_stage_tx",
      args: {},
      result_preview: JSON.stringify({
        ...tx,
        pending_tx_id: 1,
        current_lifecycle: "queued",
      }),
    };
    expect(selectActivity([event]).transactions).toHaveLength(0);
  });
});

describe("SVM preparation", () => {
  it("reconciles a staged blob and its one-id simulation with the wallet Action", () => {
    const blob = {
      payer: "wallet",
      cluster: "mainnet-beta",
      version: "v0",
      instructions: [],
      description: "Jupiter swap",
      kind: "swap",
      unsigned_transaction_base64: "YWJj",
      pending_tx_id: 1,
      current_lifecycle: "queued",
    };
    const staged = tool(1, "svm_stage_tx", { tx: blob, pending_tx_id: 1 });
    const sim = tool(2, "svm_simulate_tx", {
      tx_id: 1,
      simulation: { err: null, units_consumed: 1200 },
    });
    expect(selectActivity([staged, sim]).transactions[0].stage).toBe(
      "simulated",
    );
    const committed = action(3, {
      request: {
        type: "execute_svm",
        transactions: [blob],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [],
          fees: [],
          warnings: [],
          guards: [],
          logs: [],
          gas: null,
        },
      },
    });
    expect(selectActivity([staged, sim, committed]).transactions).toHaveLength(
      1,
    );
  });
  it("collapses staged instructions into the assembled transaction", () => {
    const ix = {
      payer: "wallet",
      cluster: "mainnet-beta",
      program_id: "program",
      data_base64: "YWJj",
      accounts: [],
      description: "Transfer",
      pending_ix_id: 1,
      current_lifecycle: "queued",
    };
    const staged = tool(1, "svm_stage_ix", { ix_ids: [1], instructions: [ix] });
    const committed = action(2, {
      request: {
        type: "execute_svm",
        transactions: [
          {
            payer: "wallet",
            cluster: "mainnet-beta",
            version: "v0",
            description: "Transfer SOL",
            kind: "transfer",
            instructions: [
              {
                program_id: "program",
                data_base64: "YWJj",
                accounts: [],
              } as never,
            ],
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [],
          fees: [],
          warnings: [],
          guards: [],
          logs: [],
          gas: null,
        },
      },
    });
    expect(selectActivity([staged, committed]).transactions).toHaveLength(1);
    const duplicate = tool(2, "svm_stage_ix", {
      ix_ids: [2],
      instructions: [{ ...ix, pending_ix_id: 2 }],
    });
    const repeated = selectActivity([
      staged,
      duplicate,
      { ...committed, sequence: 3 },
    ]).transactions;
    expect(repeated).toHaveLength(2);
    expect(repeated.filter((tx) => tx.action)).toHaveLength(1);
  });
});

describe("thread-wide activity", () => {
  it("retains skills and subagents after a new user turn", () => {
    const events: Event[] = [
      tool(1, "activate_skill", { activated: ["aave", "common_erc20"] }),
      {
        ...meta(2),
        type: "task_started",
        call_id: "call",
        agent_id: "agent",
        label: "Find route",
        app: "swap",
        resumed: false,
      } as Event,
      {
        ...meta(3),
        type: "task_completed",
        call_id: "call",
        agent_id: "agent",
        status: "completed",
        message: "Done",
        staged_count: 0,
        steps: 1,
        duration_ms: 1,
      } as Event,
      {
        ...meta(4, "turn-2"),
        type: "message",
        sender: "user",
        content: "Next",
      } as Event,
      tool(5, "activate_skill", { activated: ["aave"] }, "turn-2"),
    ];
    const result = selectActivity(events);
    expect(result.skills).toEqual(["aave", "common_erc20"]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].label).toBe("Find route");
    expect(result.agents[0].status).toBe("completed");
  });
  it("keeps repeated transfers and reused stage IDs distinct across turns", () => {
    const first = action(2, { state: "completed" });
    const secondStage = tool(
      5,
      "evm_stage_tx",
      { ...tx, pending_tx_id: 1, current_lifecycle: "queued" },
      "turn-2",
    );
    const second = action(6, { id: "a2", turn_id: "turn-2" });
    const result = selectActivity(
      [stage, first, secondStage, second],
      [second],
    );
    expect(result.history).toHaveLength(1);
    expect(result.history[0].action?.id).toBe("a1");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].action?.id).toBe("a2");
    expect(result.transactions[0].sequence).toBeGreaterThan(
      result.history[0].sequence!,
    );
  });
  it("does not promote an old transaction when a later result revision arrives", () => {
    const old = action(2);
    const newer = action(5, { id: "a2", turn_id: "turn-2" });
    const result = selectActivity(
      [old, newer, { ...old, sequence: 8, revision: 2, state: "completed" }],
      [newer],
    );
    expect(result.history[0].sequence).toBe(2);
    expect(
      result.transactions.find((tx) => tx.action?.id === "a2")?.sequence,
    ).toBe(5);
  });
});
