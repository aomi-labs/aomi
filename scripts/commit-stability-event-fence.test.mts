import { strict as assert } from "node:assert";
import {
  callbackReadback,
  isCompleteForTurn,
  isTerminalForTurn,
  newestProcessingTurn,
} from "./commit-stability-event-fence.mts";

const page = [
  {
    type: "turn_state_changed",
    turn_id: "turn_old",
    state: "complete",
    sequence: 19,
  },
  {
    type: "turn_state_changed",
    turn_id: "broadcast-terminal:old",
    state: "complete",
    sequence: 32,
  },
  {
    type: "turn_state_changed",
    turn_id: "turn_new",
    state: "processing",
    sequence: 33,
  },
  { type: "message", turn_id: "turn_new", sequence: 34 },
] as const;
assert.equal(newestProcessingTurn(page), "turn_new");
assert.equal(
  page.some((item) => isTerminalForTurn(item, "turn_new", 32)),
  false,
);
assert.equal(
  isTerminalForTurn(
    {
      type: "turn_state_changed",
      turn_id: "turn_new",
      state: "complete",
      sequence: 45,
    },
    "turn_new",
    32,
  ),
  true,
);
assert.equal(
  isCompleteForTurn(
    {
      type: "turn_state_changed",
      turn_id: "broadcast-terminal:old",
      state: "complete",
      sequence: 46,
    },
    "turn_new",
    32,
  ),
  false,
);
assert.equal(
  isCompleteForTurn(
    {
      type: "turn_state_changed",
      turn_id: "turn_new",
      state: "complete",
      sequence: 45,
    },
    "turn_new",
    32,
  ),
  true,
);
console.log("event turn fence PASS");

const callbackTurn = "broadcast-terminal:batch-one";
const response = {
  type: "message",
  turn_id: callbackTurn,
  sequence: 31,
  sender: "agent",
  message_key: `${callbackTurn}:response`,
  content: "Prepared pair; confirm to continue.",
  is_streaming: false,
};
const complete = {
  type: "turn_state_changed",
  turn_id: callbackTurn,
  sequence: 32,
  state: "complete",
};
assert.equal(callbackReadback(page, "batch-one").ready, false);
assert.equal(callbackReadback([response], "batch-one").ready, false);
assert.equal(callbackReadback([complete], "batch-one").ready, false);
assert.equal(
  callbackReadback([{ ...response, content: " " }, complete], "batch-one")
    .ready,
  false,
);
assert.equal(
  callbackReadback([{ ...response, is_streaming: true }, complete], "batch-one")
    .ready,
  false,
);
assert.equal(
  callbackReadback([response, { ...complete, state: "failed" }], "batch-one")
    .ready,
  false,
);
assert.equal(
  callbackReadback([response, { ...complete, sequence: 30 }], "batch-one")
    .ready,
  false,
);
assert.equal(
  callbackReadback([response, complete], "other-batch").ready,
  false,
);
assert.equal(
  callbackReadback([complete, ...page, response], "batch-one").ready,
  true,
);
assert.equal(
  callbackReadback(
    [response, complete, { ...complete, sequence: 33, state: "processing" }],
    "batch-one",
  ).ready,
  false,
);
assert.equal(
  callbackReadback(
    [
      response,
      { ...complete, state: "failed" },
      { ...complete, sequence: 33, state: "processing" },
    ],
    "batch-one",
  ).state,
  "processing",
);
console.log("exact callback readback fence PASS");
