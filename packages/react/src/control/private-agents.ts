"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createScopedStorage, type AgentCard } from "@aomi-labs/client";
import { useAomiDisplayCache } from "../query/display-cache";

const EMPTY: AgentCard[] = [];
type Entry = { agent: AgentCard; key: string };

/** Tab-local credentials, partitioned by backend and account, keyed by exact ID. */
export class PrivateAgentStore {
  private entries: Entry[] = [];
  private agents = EMPTY;
  private listeners = new Set<() => void>();
  private storage?: ReturnType<typeof createScopedStorage>;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.agents;
  getKey = (id: string) =>
    this.entries.find(({ agent }) => agent.agent === id)?.key;
  add = (agent: AgentCard, key: string) => {
    if (!key.trim())
      throw new Error("A private agent identity and key are required");
    this.entries = [
      ...this.entries.filter(
        ({ agent: current }) => current.agent !== agent.agent,
      ),
      { agent, key: key.trim() },
    ];
    this.storage?.setJson("privateAgents", this.entries);
    this.publish();
  };
  remove = (id: string) => {
    this.entries = this.entries.filter(({ agent }) => agent.agent !== id);
    this.storage?.setJson("privateAgents", this.entries);
    this.publish();
  };
  persist(backendUrl: string, principal: string) {
    if (this.storage) return;
    let storage: Storage | null = null;
    try {
      storage = globalThis.sessionStorage;
    } catch {
      /* Browser policy. */
    }
    this.storage = createScopedStorage({ backendUrl, principal }, { storage });
    const saved = this.storage.getJson<Entry[]>(
      "privateAgents",
      (value): value is Entry[] =>
        Array.isArray(value) &&
        value.every(
          (entry) =>
            entry &&
            typeof entry.key === "string" &&
            typeof entry.agent?.agent === "string" &&
            Number.isSafeInteger(entry.agent.agent_id),
        ),
    );
    if (saved) {
      this.entries = saved;
      this.publish();
    }
  }
  private publish() {
    this.agents = this.entries.map(({ agent }) => agent);
    this.listeners.forEach((listener) => listener());
  }
}

const stores = new Map<string, PrivateAgentStore>();
export function usePrivateAgents(persistence: "memory" | "session" = "memory") {
  const cache = useAomiDisplayCache();
  const backendUrl = cache?.scope.backendUrl ?? "";
  const account = cache?.scope.account;
  const principal = account ? `${account.kind}:${account.id}` : "anonymous";
  const store = useMemo(() => {
    const id = JSON.stringify([backendUrl, principal]);
    let current = stores.get(id);
    if (!current) {
      current = new PrivateAgentStore();
      stores.set(id, current);
    }
    return current;
  }, [backendUrl, principal]);
  useEffect(() => {
    if (persistence === "session") store.persist(backendUrl, principal);
  }, [store, persistence, backendUrl, principal]);
  const agents = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => EMPTY,
  );
  return { agents, add: store.add, remove: store.remove, getKey: store.getKey };
}
