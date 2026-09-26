import type { Event } from "../../packages/client/src/agent/types";

// Minimized shape of the live-browser regression: the original wallet tool
// result (seq 11) evolves via callback completion (seq 15), then the callback
// prepares an uncommitted pair and completes (seq 31/32). Identities are synthetic.
export const callbackRoot = "fixture-wallet-turn";
export const callbackBatch = "fixture-batch";
export const callbackTurn = `broadcast-terminal:${callbackBatch}`;
export const callbackCall = "call_wallet-preparation";
export const callbackFinalText =
  "The pair is prepared. Awaiting your confirmation.";
const event = (sequence: number, turn: string, payload: object): Event =>
  ({
    event_id: `callback-event-${sequence}`,
    sequence,
    turn_id: turn,
    occurred_at: 1_790_408_590 + sequence,
    ...payload,
  }) as Event;
const tool = (
  sequence: number,
  turn: string,
  name: string,
  call: string,
  result: object,
) =>
  event(sequence, turn, {
    type: "message",
    sender: "agent",
    content: "",
    message_key: `${turn}:tool:${sequence}`,
    is_streaming: false,
    tool_name: name,
    tool_call_id: call,
    tool_result: [name, JSON.stringify(result)],
  });
const note = (
  sequence: number,
  turn: string,
  text: string,
  key = `${turn}:trace:${sequence}`,
) =>
  event(sequence, turn, {
    type: "message",
    sender: "agent",
    content: text,
    message_key: key,
    is_streaming: false,
  });
export const callbackEvents: Event[] = [
  event(1, callbackRoot, { type: "turn_state_changed", state: "processing" }),
  event(2, callbackRoot, {
    type: "message",
    sender: "user",
    content:
      "Complete the transfer, then prepare a pair without committing it.",
  }),
  note(3, callbackRoot, "I will check the wallet first."),
  tool(4, callbackRoot, "get_account_info", "call_context", { ready: true }),
  note(7, callbackRoot, "I will stage and simulate the transfer."),
  tool(8, callbackRoot, "evm_stage_tx", "call_initial-stage", {
    pending_tx_id: 1,
  }),
  tool(9, callbackRoot, "simulate_batch", "call_initial-simulate", {
    batch_success: true,
  }),
  tool(11, callbackRoot, "evm_commit_txs", callbackCall, {
    commits: [
      {
        commit_id: "fixture-commit",
        batch: { batch_id: callbackBatch },
        state: "needs_signature",
      },
    ],
  }),
  note(12, callbackRoot, "The transfer needs wallet approval."),
  event(13, callbackRoot, { type: "turn_state_changed", state: "complete" }),
  event(14, callbackTurn, { type: "turn_state_changed", state: "processing" }),
  event(15, callbackTurn, {
    type: "tool_complete",
    id: "fixture-wallet-receipt",
    call_id: callbackCall,
    tool_name: "evm_commit_txs",
    result: {
      status: "success",
      commit_id: "fixture-commit",
      identifier: { kind: "hash", value: "fixture-hash" },
    },
  }),
  note(16, callbackTurn, "I will now check the pool and prepare the pair."),
  tool(17, callbackTurn, "get_account_info", "call_callback-context", {
    ready: true,
  }),
  note(26, callbackTurn, "I will stage the approval and supply in order."),
  tool(27, callbackTurn, "evm_stage_tx", "call_approval", { pending_tx_id: 2 }),
  tool(28, callbackTurn, "evm_stage_tx", "call_supply", { pending_tx_id: 3 }),
  note(
    29,
    callbackTurn,
    "I am simulating the pair and leaving it uncommitted.",
  ),
  tool(30, callbackTurn, "simulate_batch", "call_callback-simulate", {
    batch_success: true,
  }),
  note(31, callbackTurn, callbackFinalText, `${callbackTurn}:response`),
  event(32, callbackTurn, { type: "turn_state_changed", state: "complete" }),
];
