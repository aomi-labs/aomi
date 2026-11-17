"use client";

import { createElement } from "react";
import { AppWindow } from "lucide-react";
import { useAuthEndpoints } from "@aomi-labs/react";
import type { DirectRoutingAgent } from "./routing";
import type { AgentTagRequest } from "@/composer/capability-composer/model";
import { resolveAgentIdentity } from "@aomi-labs/client";
import { getAgentIcon } from "@/icons/agent-map";
import { testIds } from "@/test-ids";

/** Informational agent context beside the composer's model and safety controls. */
export function AgentIndicator({
  agent,
}: {
  agent?: DirectRoutingAgent | AgentTagRequest;
}) {
  const { state } = useAuthEndpoints();
  if (!agent) return null;
  // Hosted identity takes precedence over a name shared by several publishers.
  const descriptor = state.agentCards.find(
    (candidate) => candidate.agent === agent.agent,
  );
  const configuredAgent = descriptor ?? agent.agent;
  if (!configuredAgent) return null;
  const identity = resolveAgentIdentity(configuredAgent);
  const Icon = getAgentIcon(identity.brandId) ?? AppWindow;

  return (
    <span
      data-testid={testIds.composerSelectedAgent}
      aria-label={`Selected agent: ${identity.displayName}`}
      title={identity.displayName}
      className="text-aomi-muted inline-flex h-8 shrink-0 items-center gap-px rounded-full px-2.5 text-xs md:gap-1.5"
    >
      {createElement(Icon, {
        "aria-hidden": true,
        className: "size-3 shrink-0 opacity-60",
      })}
      <span>{identity.displayName}</span>
    </span>
  );
}
