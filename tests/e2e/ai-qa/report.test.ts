import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFor, tally, type FlowOutcome } from "./report";

const flow = (id: string) => ({ id, source: "x", goal: id });
const flows = ["a", "b", "c"].map(flow);
const notRun = (f: ReturnType<typeof flow>): FlowOutcome => ({
  flow: f,
  verdict: "not_run",
  summary: "Not run",
});

test("every selected flow has exactly one outcome, in order", () => {
  const results: FlowOutcome[] = [
    { flow: flows[1], verdict: "fail", summary: "" },
    { flow: flows[0], verdict: "pass", summary: "" },
  ];
  const all = accountFor(flows, results, notRun);
  assert.deepEqual(
    all.map((r) => [r.flow.id, r.verdict]),
    [
      ["a", "pass"],
      ["b", "fail"],
      ["c", "not_run"],
    ],
  );
  assert.equal(tally(all), "3 flows: 1 pass, 1 fail, 1 not_run");
});

test("a duplicate or unselected result is an error", () => {
  const pass = (f: ReturnType<typeof flow>): FlowOutcome => ({
    flow: f,
    verdict: "pass",
    summary: "",
  });
  assert.throws(() =>
    accountFor(flows, [pass(flows[0]), pass(flows[0])], notRun),
  );
  assert.throws(() => accountFor(flows, [pass(flow("z"))], notRun));
});
