import type { Flow } from "./flows";

export type Verdict =
  | "pass"
  | "fail"
  | "blocked"
  | "incomplete"
  | "harness_error"
  | "not_run";

export type FlowOutcome = { flow: Flow; verdict: Verdict; summary: string };

/**
 * One outcome per selected flow, in flow order: a flow without a result is
 * NOT_RUN, and a result for a flow that was not selected is an error.
 */
export function accountFor<R extends FlowOutcome>(
  flows: Flow[],
  results: R[],
  notRun: (flow: Flow) => R,
): R[] {
  const byId = new Map(results.map((r) => [r.flow.id, r]));
  if (byId.size !== results.length)
    throw new Error("A flow was reported more than once");
  for (const id of byId.keys())
    if (!flows.some((flow) => flow.id === id))
      throw new Error(`Result for an unselected flow: ${id}`);
  return flows.map((flow) => byId.get(flow.id) ?? notRun(flow));
}

/** "13 flows: 10 pass, 1 fail, 2 not_run" — every verdict that occurs. */
export function tally(results: FlowOutcome[]): string {
  const counts = new Map<Verdict, number>();
  for (const r of results)
    counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  const parts = [...counts].map(([verdict, n]) => `${n} ${verdict}`);
  return `${results.length} flows: ${parts.join(", ")}`;
}
