import { describe, expect, it } from "vitest";
import { summarizeSimulation } from "../src/simulation";

describe("simulation evidence", () => {
  const step = {
    chain_id: 5042002,
    execution: { status: { kind: "succeeded" }, gas_used: 21000 },
  };
  const report = { contexts: [{ chain_id: 5042002 }], steps: [step] };
  it("derives verdict and gas from the canonical evidence", () => {
    expect(summarizeSimulation(report)).toEqual({
      passed: true,
      gas: 21000,
      steps: 1,
      chainIds: [5042002],
    });
  });
  it("does not treat empty, skipped, failed or uncontextualized steps as success", () => {
    expect(summarizeSimulation({ ...report, steps: [] })?.passed).toBe(false);
    expect(
      summarizeSimulation({ ...report, steps: [step, { execution: null }] })
        ?.passed,
    ).toBe(false);
    expect(
      summarizeSimulation({
        ...report,
        steps: [{ ...step, execution: { status: { kind: "failed" } } }],
      })?.passed,
    ).toBe(false);
    expect(summarizeSimulation({ ...report, contexts: [] })?.passed).toBe(
      false,
    );
  });
  it("never promotes partial evidence in an error envelope", () => {
    expect(
      summarizeSimulation({
        error: { code: "incomplete", partial: report, interrupted_step: 2 },
      }),
    ).toBeUndefined();
  });
});
