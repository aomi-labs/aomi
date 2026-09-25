/** Read current execution evidence. Old thread history can use its own legacy
 * renderer; no legacy fields are added to the public simulation contract. */
export function summarizeSimulation(value: unknown):
  | {
      passed: boolean;
      gas: number;
      steps: number;
      chainIds: number[];
    }
  | undefined {
  if (!value || typeof value !== "object") return undefined;
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.contexts) || !Array.isArray(report.steps))
    return undefined;
  const chainIds = report.contexts.flatMap((context) =>
    context && typeof context.chain_id === "number" ? [context.chain_id] : [],
  );
  const successful = (step: unknown): boolean => {
    if (!step || typeof step !== "object") return false;
    const record = step as Record<string, unknown>;
    if (!chainIds.includes(record.chain_id as number)) return false;
    const execution = record.execution as { status?: { kind?: string } } | null;
    return execution?.status?.kind === "succeeded";
  };
  return {
    passed: report.steps.length > 0 && report.steps.every(successful),
    gas: report.steps.reduce(
      (sum, step) =>
        sum +
        (successful(step) && Number.isSafeInteger(step.execution?.gas_used)
          ? step.execution.gas_used
          : 0),
      0,
    ),
    steps: report.steps.length,
    chainIds,
  };
}
import type { SimulationError } from "./types";

export class SimulationApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: SimulationError,
  ) {
    super(detail?.message ?? `Simulation request failed (HTTP ${status})`);
    this.name = "SimulationApiError";
  }
}
