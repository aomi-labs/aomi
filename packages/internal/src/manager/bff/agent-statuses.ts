import type { PlatformAgent } from "@aomi-labs/deploy";
import type { LaunchAgentStatusesResult } from "@aomi-labs/deploy/launch";

/** Map the manager client's agent flags to the browser-safe project runtime contract. */
export function launchAgentStatusesResult(
  projectId: number,
  agents: readonly PlatformAgent[],
): LaunchAgentStatusesResult {
  const runtimeAgents = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    is_active: agent.isActive,
    loaded: agent.loaded === true,
  }));
  const live =
    runtimeAgents.length > 0 &&
    runtimeAgents.every((agent) => agent.is_active && agent.loaded);
  return {
    ok: true,
    projectId,
    state: live ? "live" : "pending",
    agents: runtimeAgents,
  };
}
