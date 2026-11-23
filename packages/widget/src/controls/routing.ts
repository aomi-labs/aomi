import {
  isAgentSlug,
  type AgentMode,
  type AgentTarget,
} from "@aomi-labs/client";

export type DirectRoutingAgent = { agent: string };

export type AomiRoutingTarget =
  | { mode: "auto" }
  | { mode: "direct"; agents: readonly DirectRoutingAgent[] };

/**
 * Host-owned agent routing. Users get no mode control: every chat runs
 * `defaultMode`, and Direct keeps the thread's agent when `targets` allows it,
 * else the first listed agent.
 */
export type AomiRoutingConfig = {
  targets?: readonly AomiRoutingTarget[];
  defaultMode?: AgentMode;
};

export type NormalizedAomiRouting = {
  modes: readonly AgentMode[];
  directAgents: readonly DirectRoutingAgent[];
  defaultMode: AgentMode;
  error: string | null;
};

const DEFAULT_ROUTING: NormalizedAomiRouting = {
  modes: ["auto"],
  directAgents: [],
  defaultMode: "auto",
  error: null,
};

function directAgentKey(target: DirectRoutingAgent): string {
  return target.agent;
}

export function toAgentTarget(target: DirectRoutingAgent): AgentTarget {
  return { ...target };
}

export function sameDirectRoutingAgent(
  left: DirectRoutingAgent,
  right: DirectRoutingAgent,
): boolean {
  return directAgentKey(left) === directAgentKey(right);
}

export function normalizeAomiRouting(
  routing?: AomiRoutingConfig,
): NormalizedAomiRouting {
  if (!routing) return DEFAULT_ROUTING;
  const targets = routing.targets ?? [{ mode: "auto" as const }];
  if (targets.length === 0) {
    return {
      ...DEFAULT_ROUTING,
      error: "Routing must allow at least one mode.",
    };
  }

  const hasAuto = targets.some((target) => target.mode === "auto");
  const directTargets = targets.filter(
    (target): target is Extract<AomiRoutingTarget, { mode: "direct" }> =>
      target.mode === "direct",
  );
  const directAgents = [
    ...new Map(
      directTargets
        .flatMap((target) => target.agents)
        .map((target) => [directAgentKey(target), target]),
    ).values(),
  ];
  const invalidDirectAgent = directAgents.some(
    (target) => !isAgentSlug(target.agent),
  );
  if (invalidDirectAgent) {
    return {
      ...DEFAULT_ROUTING,
      error: "Direct routing agents need a publisher/name slug.",
    };
  }
  if (directTargets.length > 0 && directAgents.length === 0) {
    return {
      ...DEFAULT_ROUTING,
      error: "Direct routing must include at least one agent.",
    };
  }

  const modes: AgentMode[] = [
    ...(hasAuto ? (["auto"] as const) : []),
    ...(directTargets.length > 0 ? (["direct"] as const) : []),
  ];
  if (modes.length === 0) {
    return {
      ...DEFAULT_ROUTING,
      error: "Routing must allow Auto or Direct.",
    };
  }
  const defaultMode = routing.defaultMode ?? (hasAuto ? "auto" : "direct");
  if (!modes.includes(defaultMode)) {
    return {
      modes,
      directAgents,
      defaultMode: modes[0]!,
      error: `The default mode ${defaultMode} is not enabled by routing.`,
    };
  }
  return {
    modes,
    directAgents,
    defaultMode,
    error: null,
  };
}
