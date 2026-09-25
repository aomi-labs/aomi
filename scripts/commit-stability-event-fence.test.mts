import { strict as assert } from "node:assert";
import { isCompleteForTurn, isTerminalForTurn, newestProcessingTurn } from "./commit-stability-event-fence.mts";

const page = [
  { type: "turn_state_changed", turn_id: "turn_old", state: "complete", sequence: 19 },
  { type: "turn_state_changed", turn_id: "broadcast-terminal:old", state: "complete", sequence: 32 },
  { type: "turn_state_changed", turn_id: "turn_new", state: "processing", sequence: 33 },
  { type: "message", turn_id: "turn_new", sequence: 34 },
] as const;
assert.equal(newestProcessingTurn(page), "turn_new");
assert.equal(page.some((item) => isTerminalForTurn(item, "turn_new", 32)), false);
assert.equal(isTerminalForTurn({ type: "turn_state_changed", turn_id: "turn_new", state: "complete", sequence: 45 }, "turn_new", 32), true);
assert.equal(isCompleteForTurn({ type: "turn_state_changed", turn_id: "broadcast-terminal:old", state: "complete", sequence: 46 }, "turn_new", 32), false);
assert.equal(isCompleteForTurn({ type: "turn_state_changed", turn_id: "turn_new", state: "complete", sequence: 45 }, "turn_new", 32), true);
console.log("event turn fence PASS");
