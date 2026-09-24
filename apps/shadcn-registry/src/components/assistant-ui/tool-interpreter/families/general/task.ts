import { asRecord, asInteger, asString, statusFact } from "../../normalize";
import type { ToolFact, ToolMatcher, ToolOperation } from "../../types";

/**
 * The orchestrator's `task` tool — one delegation to a child agent.
 *
 * The trace normally renders these through `WorkingAgent`, which owns its own
 * header. This family is the fallback interpretation: it is what a `task`
 * transcript part looks like anywhere `interpretToolStep` is applied to it —
 * a run whose result carries no `agent_id` join key, an older transcript, or a
 * "Phase 0" reload with no live sidecar.
 *
 * Args are the `ChildTaskRequest` (`{label, app, prompt}`); the public result
 * projection is `{agent_id, status, staged_count}`.
 */

const TASK_TOOL_NAME = "task";

/** Enough of the agent id to tell two children apart, without the noise. */
export const shortAgentId = (agentId: string): string => {
  const tail = agentId.slice(-8);
  return tail.length > 0 ? tail : agentId;
};

const looksLikeTaskResult = (
  record: Record<string, unknown> | null,
): boolean => {
  if (!record) return false;
  return typeof record.agent_id === "string" && "status" in record;
};

export const matchTaskDelegation: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const isTaskCall =
    rawLabel.trim().toLowerCase() === TASK_TOOL_NAME ||
    looksLikeTaskResult(resultRecord);
  if (!isTaskCall) return null;

  const args = asRecord(parsedArgs);
  const label = asString(args?.label);
  const agentId = asString(resultRecord?.agent_id);
  const status = asString(resultRecord?.status);
  const stagedCount = asInteger(resultRecord?.staged_count) ?? 0;

  const facts: Array<ToolFact | null> = [
    agentId
      ? { kind: "code", value: shortAgentId(agentId), source: "result" }
      : null,
    stagedCount > 0
      ? {
          kind: "count",
          role: "staged",
          value: String(stagedCount),
          source: "result",
        }
      : null,
    // A completed delegation is the quiet default — only say so when it isn't.
    status && status !== "completed" ? statusFact(status) : null,
  ];

  return {
    id: "task.delegate",
    facts: facts.filter((fact): fact is ToolFact => fact != null),
    confidence: "high",
    rawLabel,
    title: label ? `Delegated: ${label}` : "Delegated task",
    failed: status != null && status !== "completed",
  } satisfies ToolOperation;
};
