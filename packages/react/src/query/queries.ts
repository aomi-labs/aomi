import {
  type AgentCard,
  type Aomi,
  type CreditBalance,
  type CreditLedger,
} from "@aomi-labs/client";
import type { DisplayQuery } from "./display-cache";

/** Display reads the runtime loads through its `Aomi`. */
export const displayQueries = {
  models: (aomi: Aomi): DisplayQuery<string[]> => ({
    resource: "models",
    fetcher: (signal) =>
      aomi.raw.getPublicCatalog<string[]>("models", { signal }),
  }),
  authorizedModels: (
    aomi: Aomi,
    input: { sessionId: () => string; agentScope: string; credential: number },
  ): DisplayQuery<string[]> => ({
    resource: "authorized-models",
    parameters: [input.agentScope, input.credential],
    fetcher: (signal) => aomi.raw.getModels(input.sessionId(), { signal }),
  }),
  authorizedAgents: (
    aomi: Aomi,
    input: { credential: number; apiKey: () => string | null },
  ): DisplayQuery<AgentCard[]> => ({
    resource: "authorized-agents",
    parameters: [input.credential],
    fetcher: async (signal) => {
      const key = input.apiKey();
      return key ? [await aomi.raw.resolveAgentKey(key, { signal })] : [];
    },
  }),
  credits: (aomi: Aomi, enabled = true): DisplayQuery<CreditBalance> => ({
    resource: "credits",
    enabled,
    fetcher: (signal) => aomi.account.credits.get({ signal }),
  }),
  creditLedger: (aomi: Aomi, enabled = true): DisplayQuery<CreditLedger> => ({
    resource: "credit-ledger",
    enabled,
    fetcher: (signal) => aomi.account.credits.ledger({ limit: 25, signal }),
  }),
};
