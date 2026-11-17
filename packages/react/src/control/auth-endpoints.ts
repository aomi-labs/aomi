// Models and agents this runtime may use. Both are scoped to the credential
// (agent key and account), not to the open chat, so switching chats never
// refetches them. Models can use the public catalog; an explicit agent key
// resolves its one private agent.

import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import type { AgentCard, Aomi } from "@aomi-labs/client";
import { useAomiDisplayCache, useDisplayQuery } from "../query/display-cache";
import { displayQueries } from "../query/queries";
import { resolveAutoModel } from "./model-selection";

export type AuthEndpointsState = {
  availableModels: string[];
  defaultModel: string | null;
  authorizedAgents: string[];
  agentCards: AgentCard[];
  defaultAgent: string | null;
  /** False once the latest model read settled (success or failure). */
  modelsLoading?: boolean;
};

export type AuthEndpointsActions = {
  /** Force a refresh of the models list. */
  getAvailableModels: () => Promise<string[]>;
  /** Force a refresh of the authorized agents list. */
  getAuthorizedAgents: () => Promise<string[]>;
};

type UseAuthEndpointsOptions = {
  aomiRef: MutableRefObject<Aomi>;
  apiKeyRef: MutableRefObject<string | null>;
  /** Stable getter for the current control-session id (clientId + sessionId). */
  getControlSessionId: () => string;
  apiKey: string | null;
  /** Changes whenever the agent key does. */
  credentialRevision: number;
  /** Hosted agent this runtime is scoped to; routed on by the edge. */
  agent?: string | null;
  accountSessionAvailable?: boolean;
};

const NO_AGENTS: AgentCard[] = [];
const NO_MODELS: string[] = [];

function getDefaultAgent(agents: string[]): string | null {
  return agents[0] ?? "aomi/main";
}

const agentNames = (agents: ReadonlyArray<AgentCard>) =>
  agents.map((agent) => agent.agent);

/** Provider-internal: consumers use `useAuthEndpoints` from control-context. */
export function useAuthEndpointsImpl({
  aomiRef,
  apiKeyRef,
  getControlSessionId,
  apiKey,
  credentialRevision,
  agent,
}: UseAuthEndpointsOptions): {
  state: AuthEndpointsState;
  actions: AuthEndpointsActions;
} {
  const api = aomiRef.current;
  const agentScope = agent ?? "";
  const credential = {
    sessionId: getControlSessionId,
    agentScope,
    credential: credentialRevision,
  };
  const publicLane = Boolean(useAomiDisplayCache()) && !apiKey;
  const models = useDisplayQuery(
    publicLane
      ? displayQueries.models(api)
      : displayQueries.authorizedModels(api, credential),
  );
  const agents = useDisplayQuery(
    displayQueries.authorizedAgents(api, {
      credential: credentialRevision,
      apiKey: () => apiKeyRef.current,
    }),
  );
  const agentCards = agents.data ?? NO_AGENTS;
  // Agent sponsorship describes that agent's funding, not general chat model
  // availability. Supplier selection belongs to the backend routing policy.
  const availableModels = models.data ?? NO_MODELS;
  const authorizedAgents = useMemo(() => agentNames(agentCards), [agentCards]);
  const getAvailableModels = useCallback(
    async () => (await models.refetch()).data ?? NO_MODELS,
    [models.refetch],
  );
  const getAuthorizedAgents = useCallback(
    async () => agentNames((await agents.refetch()).data ?? NO_AGENTS),
    [agents.refetch],
  );

  return {
    state: {
      availableModels,
      defaultModel: resolveAutoModel(availableModels),
      authorizedAgents,
      agentCards,
      defaultAgent: getDefaultAgent(authorizedAgents),
      modelsLoading: models.isPending,
    },
    actions: { getAvailableModels, getAuthorizedAgents },
  };
}
